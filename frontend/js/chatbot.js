// Chatbot Frontend Controller
class ChatbotUI {
    constructor() {
        this.container = document.getElementById('chatbot-container');
        this.header = document.getElementById('chatbot-header');
        this.body = document.getElementById('chatbot-body');
        this.inputForm = document.getElementById('chatbot-input-form');
        this.input = document.getElementById('chatbot-input');
        this.sendBtn = document.getElementById('chatbot-send-btn');
        this.minimizeBtn = document.getElementById('minimize-btn');
        this.closeBtn = document.getElementById('close-btn');
        this.welcome = document.getElementById('chatbot-welcome');

        this.isMinimized = false;
        this.dragOffset = { x: 0, y: 0 };
        this.pendingQueries = new Map(); // Track pending queries by ID
        // Maintenance/disabled mode (unknown until we probe)
        this.disabled = null;
        this.disabledMessage = 'Sorry the assistance is not yet available.';
        this._disabledMsgShown = false;

        this.initialize();
    }

    initialize() {
        this.setupEventListeners();
        this.setupDragging();
        this.setupMessageListener();
        this.restorePosition();
        // Re-clamp on resize so the chat never gets lost offscreen
        window.addEventListener('resize', () => this.clampToViewport());
        // Probe availability from Electron; default to enabled if not reachable
        this.probeAvailability();
    }

    setupMessageListener() {
        // Listen for responses from parent window
        window.addEventListener('message', (event) => {
            // Handle open command from parent
            if (event.data && event.data.action === 'open-chatbot') {
                this.showChatbot();
                return;
            }

            // Handle responses from parent
            if (event.data && event.data.type === 'chatbot-response') {
                const { queryId, response } = event.data;
                const handler = this.pendingQueries.get(queryId);
                
                if (handler) {
                    handler(response);
                    this.pendingQueries.delete(queryId);
                }
            }
        });
    }

    setupEventListeners() {
        // Form submission
        this.inputForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.disabled === true) {
                this.showDisabledMessage();
                return;
            }
            this.handleSendMessage();
        });

        // Minimize button
        this.minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMinimize();
        });

        // Close button
        this.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeChatbot();
        });

        // Click minimized container to restore
        this.container.addEventListener('click', () => {
            if (this.isMinimized) {
                this.toggleMinimize();
            }
        });
    }

    setupDragging() {
        let startX, startY, initialX, initialY;
        let isDragging = false;

        this.header.addEventListener('mousedown', (e) => {
            // Don't drag if clicking on control buttons
            if (e.target.closest('.chatbot-control-btn')) return;
            
            isDragging = true;
            this.container.classList.add('dragging');
            
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = this.container.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;

            e.preventDefault();
            e.stopPropagation();
        });

        // Use window for mouse events to track dragging outside the element
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            const newX = initialX + deltaX;
            const newY = initialY + deltaY;

            // Constrain to viewport
            const maxX = window.innerWidth - this.container.offsetWidth;
            const maxY = window.innerHeight - this.container.offsetHeight;

            const constrainedX = Math.max(0, Math.min(newX, maxX));
            const constrainedY = Math.max(0, Math.min(newY, maxY));

            this.container.style.left = `${constrainedX}px`;
            this.container.style.top = `${constrainedY}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';

            e.preventDefault();
            e.stopPropagation();
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.container.classList.remove('dragging');
                this.savePosition();
            }
        });
      
        // --- Touch support ---
        this.header.addEventListener('touchstart', (e) => {
            if (e.target.closest('.chatbot-control-btn')) return;
            if (!e.touches || e.touches.length === 0) return;
            const t = e.touches[0];
            isDragging = true;
            this.container.classList.add('dragging');
            startX = t.clientX;
            startY = t.clientY;
            const rect = this.container.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            e.preventDefault();
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const t = e.touches[0];
            const deltaX = t.clientX - startX;
            const deltaY = t.clientY - startY;
            const newX = initialX + deltaX;
            const newY = initialY + deltaY;
            const maxX = window.innerWidth - this.container.offsetWidth;
            const maxY = window.innerHeight - this.container.offsetHeight;
            const constrainedX = Math.max(0, Math.min(newX, maxX));
            const constrainedY = Math.max(0, Math.min(newY, maxY));
            this.container.style.left = `${constrainedX}px`;
            this.container.style.top = `${constrainedY}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
            e.preventDefault();
        }, { passive: false });

        window.addEventListener('touchend', () => {
            if (isDragging) {
                isDragging = false;
                this.container.classList.remove('dragging');
                this.savePosition();
            }
        });
    }

    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        this.container.classList.toggle('minimized', this.isMinimized);
        
        if (!this.isMinimized && this.disabled !== true) {
            this.input.focus();
        }
    }

    closeChatbot() {
        this.container.classList.remove('visible');
        
        // Notify parent window (if embedded in iframe)
        try {
            if (window.parent !== window) {
                window.parent.postMessage({ action: 'close-chatbot' }, '*');
            }
        } catch(e) {
            console.log('Not in iframe or cannot access parent');
        }
    }

    showChatbot() {
        this.container.classList.add('visible');
        if (this.disabled === true) {
            this.applyDisabledState();
        } else if (!this.isMinimized) {
            this.input.focus();
        }
    }

    // Send message to parent window via postMessage
    async sendMessageToParent(message) {
        return new Promise((resolve, reject) => {
            const queryId = `query-${Date.now()}-${Math.random()}`;
            
            // Store the resolver
            this.pendingQueries.set(queryId, resolve);
            
            // Prefer iframe parent if present
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'chatbot-query',
                    queryId: queryId,
                    message: message
                }, '*');
            } else if (window.electron?.ipcRenderer?.invoke || window.ipcRenderer?.invoke) {
                // Fallback: talk directly to Electron main
                const ipc = window.electron?.ipcRenderer || window.ipcRenderer;
                ipc.invoke('chatbot:query', message)
                  .then((resp) => {
                    const handler = this.pendingQueries.get(queryId);
                    if (handler) {
                      handler(resp);
                      this.pendingQueries.delete(queryId);
                    }
                  })
                  .catch((err) => {
                    this.pendingQueries.delete(queryId);
                    reject(err);
                  });
            } else {
                // Not in iframe - reject
                reject(new Error('Not running in iframe'));
            }
            
            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Query timeout'));
                }
            }, 30000);
        });
    }

    async handleSendMessage() {
        if (this.disabled === true) {
            this.showDisabledMessage();
            return;
        }
        const message = this.input.value.trim();
        if (!message) return;

        // Clear input and disable
        this.input.value = '';
        this.input.disabled = true;
        this.sendBtn.disabled = true;

        // Remove welcome message if present
        if (this.welcome) {
            this.welcome.remove();
            this.welcome = null;
        }

        // Add user message
        this.addMessage(message, 'user');

        // Add typing indicator
        const typingIndicator = this.addTypingIndicator();

        try {
            // Send via postMessage to parent window
            const response = await this.sendMessageToParent(message);
            
            // Remove typing indicator
            typingIndicator.remove();

            // Add assistant response
            if (response.success) {
                this.addMessage(response.message, 'assistant');
                
                // Log sources if available
                if (response.sources && response.sources.length > 0) {
                    console.log('Data sources used:', response.sources);
                }
            } else {
                this.addMessage(response.message, 'assistant');
                
                if (response.type === 'error') {
                    console.error('Chatbot error:', response.error);
                }
            }

        } catch (error) {
            typingIndicator.remove();
            this.addMessage('Sorry, I encountered an error. Please try again.', 'assistant');
            console.error('Chatbot error:', error);
        } finally {
            // Re-enable input
            if (this.disabled !== true) {
                this.input.disabled = false;
                this.sendBtn.disabled = false;
                this.input.focus();
            }
        }
    }

    addMessage(text, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;

        if (type !== 'system') {
            const avatar = document.createElement('div');
            avatar.className = 'message-avatar';
            avatar.textContent = type === 'user' ? '👤' : '🤖';
            messageDiv.appendChild(avatar);
        }

        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = text;
        messageDiv.appendChild(content);

        this.body.appendChild(messageDiv);
        this.scrollToBottom();

        return messageDiv;
    }

    addTypingIndicator() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = '🤖';
        messageDiv.appendChild(avatar);

        const indicator = document.createElement('div');
        indicator.className = 'message-content typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        messageDiv.appendChild(indicator);

        this.body.appendChild(messageDiv);
        this.scrollToBottom();

        return messageDiv;
    }

    scrollToBottom() {
        this.body.scrollTop = this.body.scrollHeight;
    }

    // --- Position persistence/helpers ---
    savePosition() {
        const rect = this.container.getBoundingClientRect();
        const pos = { left: rect.left, top: rect.top };
        try { localStorage.setItem('chatbot.position', JSON.stringify(pos)); } catch {}
    }

    restorePosition() {
        try {
            const raw = localStorage.getItem('chatbot.position');
            if (!raw) return;
            const pos = JSON.parse(raw);
            if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
                this.container.style.left = `${pos.left}px`;
                this.container.style.top = `${pos.top}px`;
                this.container.style.right = 'auto';
                this.container.style.bottom = 'auto';
                this.clampToViewport();
            }
        } catch {}
    }

    clampToViewport() {
        const rect = this.container.getBoundingClientRect();
        const maxX = window.innerWidth - this.container.offsetWidth;
        const maxY = window.innerHeight - this.container.offsetHeight;
        const left = Math.max(0, Math.min(rect.left, maxX));
        const top  = Math.max(0, Math.min(rect.top,  maxY));
        this.container.style.left = `${left}px`;
        this.container.style.top  = `${top}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
    }

    // ---- Availability / disabled helpers ----
    async probeAvailability() {
        try {
            const ipc = window.electron?.ipcRenderer || window.ipcRenderer;
            if (ipc?.invoke) {
                const status = await ipc.invoke('chatbot:status');
                this.setDisabled(!status.available, status.message);
            } else {
                // No IPC available; assume enabled so dev environments work
                this.setDisabled(false);
            }
        } catch {
            // If the probe fails, default to enabled
            this.setDisabled(false);
        }
    }

   setDisabled(disabled, message) {
        this.disabled = !!disabled;
        this.disabledMessage = message || this.disabledMessage;
        if (this.disabled) this.applyDisabledState();
        else this.clearDisabledState();
    }

    applyDisabledState() {
        if (!this.input || !this.sendBtn) return;
        this.input.disabled = true;
        this.sendBtn.disabled = true;
        this.input.placeholder = this.disabledMessage;
        // Update welcome text if present
        if (this.welcome?.querySelector) {
            const p = this.welcome.querySelector('p');
            if (p) p.textContent = this.disabledMessage;
        }
        this.showDisabledMessage(this.disabledMessage);
    }

    clearDisabledState() {
        if (!this.input || !this.sendBtn) return;
        this.input.disabled = false;
        this.sendBtn.disabled = false;
        this.input.placeholder = 'Ask a question about your data...';
        if (this.welcome?.querySelector) {
            const p = this.welcome.querySelector('p');
            if (p && /Sorry the assistance/i.test(p.textContent)) {
                p.textContent = 'Ask me anything about your data. I can search through your Excel files and provide detailed information about companies, locations, assets, and more.';
            }
        }
    }

    showDisabledMessage(msg) {
        if (this._disabledMsgShown) return;
        this.addMessage(msg || this.disabledMessage, 'system');
        this._disabledMsgShown = true;
    }

}

// Initialize chatbot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatbotUI = new ChatbotUI();
});

// Expose global functions for parent window if needed
window.openChatbot = () => {
    if (window.chatbotUI) {
        window.chatbotUI.showChatbot();
    }
};

window.closeChatbot = () => {
    if (window.chatbotUI) {
        window.chatbotUI.closeChatbot();
    }
};