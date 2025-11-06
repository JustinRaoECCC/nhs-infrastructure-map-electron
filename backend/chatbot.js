const { ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// Use your existing Excel infrastructure
const lookups = require('./lookups_repo');
const excelClient = require('./excel_worker_client');

class ChatbotService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;
        this.disabled = String(process.env.CHATBOT_DISABLED).toLowerCase() === 'true';
    }

    async initialize() {
        // quick availability probe (for the UI)
        ipcMain.handle('chatbot:status', async () => {
          return {
            available: !this.disabled,
            message: this.disabled ? 'Sorry the assistance is not yet available.' : 'ok'
          };
        });

        ipcMain.handle('chatbot:query', async (event, message) => {
          if (this.disabled) {
            return {
              success: false,
              type: 'disabled',
              message: 'Sorry the assistance is not yet available.'
            };
          }
          return await this.handleQuery(message);
        });

        ipcMain.handle('chatbot:get-available-data', async () => {
          if (this.disabled) {
            return { lookups: false, companies: {}, disabled: true };
          }
          return await this.getAvailableDataSources();
        });
    }

    async callOpenAI(messages, temperature = null) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.');
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                temperature: temperature !== null ? temperature : this.temperature,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    async getAvailableDataSources() {
        try {
            const sources = {
                lookups: true,
                companies: {}
            };

            // Get all companies and their locations from your existing infrastructure
            const companies = await lookups.getActiveCompanies();
            
            for (const company of companies) {
                const locations = await lookups.getLocationsForCompany(company);
                sources.companies[company] = {};
                
                for (const location of locations) {
                    // Get asset types for this company+location
                    const assetTypes = await lookups.getAssetTypesForCompanyLocation(company, location);
                    sources.companies[company][location] = assetTypes;
                }
            }

            return sources;
        } catch (error) {
            console.error('Error getting data sources:', error);
            return { lookups: true, companies: {} };
        }
    }

    isSafeContent(text) {
        const unsafePatterns = [
            /\b(sex|porn|xxx|nude|naked|explicit)\b/i,
            /\b(violent|kill|murder|harm)\b/i,
            /\b(illegal|drugs|weapon)\b/i,
            /\b(hate|racist|discrimination)\b/i
        ];

        return !unsafePatterns.some(pattern => pattern.test(text));
    }

    async handleQuery(userMessage) {
        try {
            // Content safety check
            if (!this.isSafeContent(userMessage)) {
                return {
                    success: false,
                    message: 'I can only help with questions about the application data. Please keep questions professional and appropriate.',
                    type: 'content_filter'
                };
            }

            // Stage 1: Determine which data sources to query
            const availableSources = await this.getAvailableDataSources();
            
            const stage1Messages = [
                {
                    role: 'system',
                    content: `You are a data location assistant for an asset management system. Given a user's question and available data sources, determine which specific data needs to be examined.

Available data structure:
- Companies: ${Object.keys(availableSources.companies).join(', ')}
- Each company has locations with asset types
- Available data: ${JSON.stringify(availableSources, null, 2)}

Return your response as a JSON object with this structure:
{
    "dataType": "overview|company|location|assetType|stations|repairs",
    "company": "company name or null",
    "location": "location name or null", 
    "assetType": "asset type name or null",
    "reasoning": "Brief explanation"
}

Data types:
- "overview": General questions about what data exists
- "company": Questions about a specific company
- "location": Questions about a specific location within a company
- "assetType": Questions about a specific asset type at a location
- "stations": Questions about station/asset details
- "repairs": Questions about repair information

If the question cannot be answered, return:
{
    "dataType": "none",
    "reasoning": "Explanation of why no data matches"
}`
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ];

            const stage1Response = await this.callOpenAI(stage1Messages, 0.3);
            
            // Parse Stage 1 response
            let sourceSelection;
            try {
                const jsonMatch = stage1Response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    sourceSelection = JSON.parse(jsonMatch[0]);
                } else {
                    sourceSelection = JSON.parse(stage1Response);
                }
            } catch (e) {
                console.error('Failed to parse Stage 1 response:', stage1Response);
                return {
                    success: false,
                    message: 'I had trouble understanding where to find that information. Could you rephrase your question?',
                    type: 'parse_error'
                };
            }

            // If no data type identified, try a broad station search from the text itself
            if (!sourceSelection.dataType || sourceSelection.dataType === 'none') {
              const fallback = await this.getStationsData(null, null, null, userMessage);
              if (fallback && fallback.stationCount > 0) {
                // Treat as a stations query after all
                sourceSelection = { dataType: 'stations', company: null, location: null, assetType: null };
                // Skip re-fetch; we already have the data
                const stage2Messages = [
                  { role: 'system', content: `You are a helpful data analyst assistant. Analyze the provided data and answer the user's question accurately and concisely.

            Rules:
            - Only use information from the provided data
            - If the data doesn't contain the answer, say so clearly
            - Be specific and cite relevant data points
            - Keep responses professional and focused on the data
            - Format numbers and data clearly
            - Summarize large datasets rather than listing everything`
                  },
                  { role: 'user', content: `Question: ${userMessage}\n\nData:\n${JSON.stringify(fallback, null, 2)}\n\nPlease analyze this data and answer the question.`}
                ];
                const finalResponse = await this.callOpenAI(stage2Messages);
                return { success: true, message: finalResponse, dataType: 'stations', type: 'success' };
              }
              return {
                success: true,
                message: `I don't have information about that in the available data. ${sourceSelection.reasoning || ''}`,
                type: 'no_data'
              };
            }

            // Stage 2: Retrieve the requested data
            let dataCollected = null;
            
            try {
                switch (sourceSelection.dataType) {
                    case 'overview':
                        dataCollected = await this.getOverviewData(availableSources);
                        break;
                    
                    case 'company':
                        if (!sourceSelection.company) {
                            dataCollected = await this.getAllCompaniesData(availableSources);
                        } else {
                            dataCollected = await this.getCompanyData(sourceSelection.company, availableSources);
                        }
                        break;
                    
                    case 'location':
                        dataCollected = await this.getLocationData(
                            sourceSelection.company, 
                            sourceSelection.location
                        );
                        break;
                    
                    case 'assetType':
                        dataCollected = await this.getAssetTypeData(
                            sourceSelection.company,
                            sourceSelection.location,
                            sourceSelection.assetType
                        );
                        break;
                    
                    case 'stations':
                        dataCollected = await this.getStationsData(
                          sourceSelection.company,
                          sourceSelection.location,
                          sourceSelection.assetType,
                          userMessage // <-- new
                        );
                        break;
                    
                    case 'repairs':
                        dataCollected = await this.getRepairsData(
                            sourceSelection.company,
                            sourceSelection.location
                        );
                        break;
                    
                    default:
                        dataCollected = { error: 'Unknown data type' };
                }
            } catch (error) {
                console.error('Error collecting data:', error);
                return {
                    success: false,
                    message: 'I encountered an error retrieving the data. Please try again.',
                    type: 'data_error',
                    error: error.message
                };
            }

            if (!dataCollected || dataCollected.error) {
                return {
                    success: true,
                    message: 'I found where the data should be, but encountered an error reading it.',
                    type: 'read_error'
                };
            }

            // Stage 3: Analyze the data and answer the question
            const stage2Messages = [
                {
                    role: 'system',
                    content: `You are a helpful data analyst assistant. Analyze the provided data and answer the user's question accurately and concisely.

Rules:
- Only use information from the provided data
- If the data doesn't contain the answer, say so clearly
- Be specific and cite relevant data points
- Keep responses professional and focused on the data
- Format numbers and data clearly
- Summarize large datasets rather than listing everything`
                },
                {
                    role: 'user',
                    content: `Question: ${userMessage}

Data:
${JSON.stringify(dataCollected, null, 2)}

Please analyze this data and answer the question.`
                }
            ];

            const finalResponse = await this.callOpenAI(stage2Messages);

            return {
                success: true,
                message: finalResponse,
                dataType: sourceSelection.dataType,
                type: 'success'
            };

        } catch (error) {
            console.error('Chatbot query error:', error);
            return {
                success: false,
                message: error.message.includes('API key') 
                    ? 'OpenAI API key not configured. Please add your API key to the .env file.'
                    : 'I encountered an error processing your request. Please try again.',
                type: 'error',
                error: error.message
            };
        }
    }

    async getOverviewData(sources) {
        const companies = Object.keys(sources.companies);
        const overview = {
            totalCompanies: companies.length,
            companies: {}
        };

        for (const company of companies) {
            const locations = Object.keys(sources.companies[company]);
            overview.companies[company] = {
                locationCount: locations.length,
                locations: {}
            };

            for (const location of locations) {
                const assetTypes = sources.companies[company][location];
                overview.companies[company].locations[location] = {
                    assetTypeCount: assetTypes.length,
                    assetTypes: assetTypes
                };
            }
        }

        return overview;
    }

    async getAllCompaniesData(sources) {
        return {
            companies: Object.keys(sources.companies),
            details: sources.companies
        };
    }

    async getCompanyData(company, sources) {
        const companyData = sources.companies[company];
        if (!companyData) {
            return { error: `Company "${company}" not found` };
        }

        return {
            company: company,
            locations: Object.keys(companyData),
            locationDetails: companyData
        };
    }

    async getLocationData(company, location) {
        if (!company || !location) {
            return { error: 'Company and location required' };
        }

        try {
            const assetTypes = await lookups.getAssetTypesForCompanyLocation(company, location);
            
            return {
                company: company,
                location: location,
                assetTypes: assetTypes,
                assetTypeCount: assetTypes.length
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    async getAssetTypeData(company, location, assetType) {
        if (!company || !location) {
            return { error: 'Company and location required' };
        }

        try {
            // Read the sheet data for this asset type
            let sheetName = `${assetType} ${location}`;
            let sheetData = await excelClient.readSheetData(company, location, sheetName);
            if (!sheetData.success) {
              // Fallback: scan workbook for a close match (e.g., “Cableways – BC”)
              const wb = await excelClient.readLocationWorkbook(company, location);
              if (wb.success && Array.isArray(wb.sheets)) {
                const wantedAt = String(assetType).toLowerCase();
                const wantedLoc = String(location).toLowerCase();
                const candidate = wb.sheets.find(s => {
                  const n = String(s).toLowerCase();
                  return n.includes(wantedAt) && n.includes(wantedLoc) && !/repairs$/i.test(n);
                });
                if (candidate) sheetData = await excelClient.readSheetData(company, location, candidate);
              }
            }
            
            if (!sheetData.success) {
                return { error: sheetData.message };
            }

            // Return a summary to avoid overwhelming the AI
            return {
                company: company,
                location: location,
                assetType: assetType,
                recordCount: sheetData.rows?.length || 0,
                fields: sheetData.fields || [],
                sampleData: (sheetData.rows || []).slice(0, 5) // First 5 records as sample
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    async getStationsData(company, location, assetType, searchText = '') {
        try {
            // Use the existing readStationsAggregate to get all station data
            const result = await excelClient.readStationsAggregate();
            
            if (!result.success) {
                return { error: 'Failed to read stations data' };
            }

            const toLower = (v) => String(v ?? '').toLowerCase();
            // Normalize source array name
            const all = Array.isArray(result.stations)
              ? result.stations
              : Array.isArray(result.rows)
                ? result.rows
                : [];

            let out = all.slice();

            if (company) {
                const want = toLower(company);
                out = out.filter(r => toLower(r.company) === want);
            }
            if (location) {
                const want = toLower(location);
                out = out.filter(r => toLower(r.location) === want);
            }
            if (assetType) {
                const want = toLower(assetType);
                out = out.filter(r => toLower(r.assetType ?? r.type) === want);
            }
            if (searchText && searchText.trim()) {
                const q = toLower(searchText.trim());
                out = out.filter(r => {
                    const hay = [
                        r.name, r.station, r.id, r.description, r.address, r.serial, r.model
                    ].map(toLower).join(' | ');
                    return hay.includes(q);
                });
            }

            const namesOnly = out.map(r => r.name || r.station || r.id).filter(Boolean);
            const sliced = out.slice(0, 50);

            return {
              company,
              location,
              assetType,
              stationCount: out.length,
              previewCount: sliced.length,
              namesOnly,
              stations: sliced
            };

        } catch (error) {
            return { error: error.message };
        }
    }

    async getRepairsData(company, location) {
        try {
            // Get all repairs
            const allRepairs = await excelClient.getAllRepairs();
            
            // Filter by company and/or location if specified
            let filteredRepairs = allRepairs;
            
            if (company) {
                filteredRepairs = filteredRepairs.filter(r => 
                    String(r.company || '').toLowerCase() === company.toLowerCase()
                );
            }
            
            if (location) {
                filteredRepairs = filteredRepairs.filter(r => 
                    String(r.location || '').toLowerCase() === location.toLowerCase()
                );
            }

            return {
                company: company,
                location: location,
                repairCount: filteredRepairs.length,
                repairs: filteredRepairs.slice(0, 20) // Limit to 20
            };
        } catch (error) {
            return { error: error.message };
        }
    }
}

// Initialize the chatbot service
const chatbotService = new ChatbotService();

module.exports = {
    initializeChatbot: () => chatbotService.initialize()
};