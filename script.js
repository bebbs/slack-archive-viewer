class SlackArchiveViewer {
    constructor() {
        this.channels = [];
        this.users = {};
        this.messages = {};
        this.currentChannel = null;
        this.currentArchive = null;
        this.searchQuery = '';
        this.searchResults = [];
        this.allMessages = []; // Flat array of all messages for search
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const archiveInput = document.getElementById('archiveInput');
        archiveInput.addEventListener('change', (e) => this.handleArchiveSelection(e));
        
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        const searchAllChannels = document.getElementById('searchAllChannels');
        
        searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        searchAllChannels.addEventListener('change', () => this.handleSearch(this.searchQuery));
    }

    async handleArchiveSelection(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        this.showLoading('Loading archive...');

        try {
            // Group files by directory structure
            const archiveData = this.groupFilesByArchive(files);
            
            // Load the first archive found
            const archiveName = Object.keys(archiveData)[0];
            const archiveFiles = archiveData[archiveName];
            
            await this.loadArchive(archiveName, archiveFiles);
            
        } catch (error) {
            console.error('Error loading archive:', error);
            this.showError('Failed to load archive. Please check the file structure.');
        }
    }

    groupFilesByArchive(files) {
        const archives = {};
        
        files.forEach(file => {
            const pathParts = file.webkitRelativePath.split('/');
            const archiveName = pathParts[0];
            
            if (!archives[archiveName]) {
                archives[archiveName] = [];
            }
            archives[archiveName].push(file);
        });
        
        return archives;
    }

    async loadArchive(archiveName, files) {
        this.currentArchive = archiveName;
        
        // Find and load channels.json
        const channelsFile = files.find(f => f.name === 'channels.json');
        if (channelsFile) {
            this.channels = await this.parseJsonFile(channelsFile);
        }

        // Find and load users.json
        const usersFile = files.find(f => f.name === 'users.json');
        if (usersFile) {
            const usersArray = await this.parseJsonFile(usersFile);
            this.users = {};
            usersArray.forEach(user => {
                this.users[user.id] = user;
            });
        }

        // Load message files
        await this.loadMessageFiles(files);

        // Build flat array of all messages for search
        this.buildSearchIndex();

        this.renderChannels();
        this.hideLoading();
        
        // Auto-select the first channel if available
        if (this.channels.length > 0) {
            this.selectChannel(this.channels[0]);
        }
    }

    async loadMessageFiles(files) {
        this.messages = {};
        
        // Debug: Log all files to see what we're working with
        console.log('Total files loaded:', files.length);
        
        // Group message files by channel
        const messageFiles = files.filter(f => 
            f.name.endsWith('.json') && 
            f.name !== 'channels.json' && 
            f.name !== 'users.json' &&
            f.name !== 'huddle_transcripts.json' &&
            f.name !== 'integration_logs.json' &&
            f.name !== 'canvases.json' &&
            f.name !== 'lists.json' &&
            f.webkitRelativePath.includes('/')
        );

        console.log('Message files found:', messageFiles.length);

        const channelFiles = {};
        messageFiles.forEach(file => {
            const pathParts = file.webkitRelativePath.split('/');
            const channelName = pathParts[1]; // channel directory name
            
            if (!channelFiles[channelName]) {
                channelFiles[channelName] = [];
            }
            channelFiles[channelName].push(file);
        });

        console.log('Channels with message files:', Object.keys(channelFiles));

        // Load messages for each channel
        for (const [channelName, channelFileList] of Object.entries(channelFiles)) {
            console.log(`Loading messages for #${channelName} from ${channelFileList.length} files`);
            this.messages[channelName] = [];
            
            for (const file of channelFileList) {
                try {
                    const fileMessages = await this.parseJsonFile(file);
                    console.log(`Loaded ${fileMessages.length} messages from ${file.name}`);
                    this.messages[channelName].push(...fileMessages);
                } catch (error) {
                    console.warn(`Failed to load messages from ${file.name}:`, error);
                }
            }
            
            // Sort messages by timestamp
            this.messages[channelName].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
            console.log(`Total messages in #${channelName}: ${this.messages[channelName].length}`);
        }
    }

    async parseJsonFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target.result;
                    const data = JSON.parse(content);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    renderChannels() {
        const channelList = document.getElementById('channelList');
        channelList.innerHTML = '';

        this.channels.forEach(channel => {
            const channelElement = document.createElement('div');
            channelElement.className = 'channel-item';
            channelElement.dataset.channelId = channel.id;
            
            const messageCount = this.messages[channel.name]?.length || 0;
            
            channelElement.innerHTML = `
                <span class="channel-name">#${channel.name}</span>
                <span class="channel-count">${messageCount}</span>
            `;
            
            channelElement.addEventListener('click', () => this.selectChannel(channel));
            channelList.appendChild(channelElement);
        });
    }

    selectChannel(channel) {
        this.currentChannel = channel;
        
        // Update active state
        document.querySelectorAll('.channel-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-channel-id="${channel.id}"]`).classList.add('active');
        
        // Update header
        document.getElementById('messageHeader').innerHTML = `
            <h2>#${channel.name}</h2>
        `;
        
        this.renderMessages(channel.name);
    }

    renderMessages(channelName) {
        const messageContainer = document.getElementById('messageContainer');
        let messages = this.messages[channelName] || [];
        
        console.log(`Rendering messages for #${channelName}: ${messages.length} total messages`);
        
        if (messages.length === 0) {
            messageContainer.innerHTML = '<div class="welcome-message"><p>No messages found in this channel.</p></div>';
            return;
        }

        // Filter messages if search is active
        if (this.searchQuery) {
            messages = messages.filter(message => {
                const searchText = this.getSearchableText(message).toLowerCase();
                return searchText.includes(this.searchQuery);
            });
            
            console.log(`After search filter: ${messages.length} messages`);
            
            if (messages.length === 0) {
                messageContainer.innerHTML = `
                    <div class="welcome-message">
                        <p>No messages found in #${channelName} matching "${this.searchQuery}"</p>
                    </div>
                `;
                return;
            }
        }

        messageContainer.innerHTML = '';
        
        // Group messages by thread
        const threadGroups = this.groupMessagesByThread(messages);
        console.log(`Grouped into ${threadGroups.length} thread groups`);
        
        let renderedCount = 0;
        let threadCount = 0;
        let regularCount = 0;
        
        threadGroups.forEach(group => {
            if (group.isThread) {
                this.renderThreadedMessages(group.messages);
                renderedCount += group.messages.length;
                threadCount += group.messages.length;
            } else {
                group.messages.forEach(message => this.renderMessage(message, false, this.searchQuery && this.isSearchResult(message)));
                renderedCount += group.messages.length;
                regularCount += group.messages.length;
            }
        });
        
        console.log(`Actually rendered ${renderedCount} messages (${threadCount} in threads, ${regularCount} regular)`);
    }

    groupMessagesByThread(messages) {
        const groups = [];
        const threadMap = new Map();
        const processedMessages = new Set();
        
        console.log(`Grouping ${messages.length} messages by thread`);
        
        // First pass: collect all thread replies
        let threadReplies = 0;
        messages.forEach(message => {
            if (message.thread_ts && message.thread_ts !== message.ts) {
                // This is a reply in a thread
                if (!threadMap.has(message.thread_ts)) {
                    threadMap.set(message.thread_ts, []);
                }
                threadMap.get(message.thread_ts).push(message);
                processedMessages.add(message.ts);
                threadReplies++;
            }
        });
        
        console.log(`Found ${threadReplies} thread replies`);
        
        // Second pass: handle all messages
        let regularMessages = 0;
        let threadStarters = 0;
        
        messages.forEach(message => {
            if (processedMessages.has(message.ts)) {
                // This message was already processed as a thread reply
                return;
            }
            
            if (message.replies && message.replies.length > 0) {
                // Thread starter
                const threadMessages = [message];
                if (threadMap.has(message.ts)) {
                    threadMessages.push(...threadMap.get(message.ts));
                }
                groups.push({ isThread: true, messages: threadMessages });
                threadStarters++;
            } else {
                // Regular message
                groups.push({ isThread: false, messages: [message] });
                regularMessages++;
            }
        });
        
        console.log(`Grouped into ${regularMessages} regular messages and ${threadStarters} thread starters`);
        return groups;
    }

    renderThreadedMessages(messages) {
        const messageContainer = document.getElementById('messageContainer');
        
        messages.forEach((message, index) => {
            const isThreadStarter = index === 0;
            this.renderMessage(message, isThreadStarter ? false : true);
        });
    }

    renderMessage(message, isThreaded = false, isSearchResult = false) {
        const messageContainer = document.getElementById('messageContainer');
        const user = this.users[message.user];
        const displayName = user ? (user.display_name || user.real_name || user.name) : 'Unknown User';
        const timestamp = this.formatTimestamp(message.ts);
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isThreaded ? 'threaded' : ''} ${isSearchResult ? 'highlighted' : ''}`;
        
        const avatarContent = user?.profile?.image_72 
            ? `<img src="${user.profile.image_72}" alt="${displayName}" onerror="this.style.display='none'">`
            : `<span>${displayName.charAt(0).toUpperCase()}</span>`;
        
        const messageText = this.renderMessageText(message);
        const attachments = this.renderAttachments(message);
        
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-avatar">
                    ${avatarContent}
                </div>
                <div class="message-body">
                    <div class="message-header-info">
                        <span class="message-author">${displayName}</span>
                        <span class="message-timestamp">${timestamp}</span>
                    </div>
                    <div class="message-text">${messageText}</div>
                    ${attachments}
                </div>
            </div>
        `;
        
        messageContainer.appendChild(messageElement);
    }

    renderMessageText(message) {
        if (message.blocks) {
            return this.renderBlocks(message.blocks);
        }
        return this.escapeHtml(message.text || '');
    }

    renderBlocks(blocks) {
        return blocks.map(block => {
            if (block.type === 'rich_text') {
                return this.renderRichTextElements(block.elements);
            }
            return '';
        }).join('');
    }

    renderRichTextElements(elements) {
        return elements.map(element => {
            if (element.type === 'rich_text_section') {
                return this.renderRichTextSection(element.elements);
            }
            return '';
        }).join('');
    }

    renderRichTextSection(elements) {
        return elements.map(element => {
            if (element.type === 'text') {
                let text = this.escapeHtml(element.text);
                
                // Handle basic formatting
                if (element.style?.bold) text = `<strong>${text}</strong>`;
                if (element.style?.italic) text = `<em>${text}</em>`;
                if (element.style?.strike) text = `<del>${text}</del>`;
                
                return text;
            } else if (element.type === 'link') {
                return `<a href="${this.escapeHtml(element.url)}" target="_blank">${this.escapeHtml(element.text)}</a>`;
            }
            return '';
        }).join('');
    }

    renderAttachments(message) {
        if (!message.files || message.files.length === 0) {
            return '';
        }
        
        return message.files.map(file => {
            if (file.mimetype && file.mimetype.startsWith('image/')) {
                return `
                    <div class="message-attachment">
                        <img src="${file.url_private}" alt="${file.name}" class="attachment-image" 
                             onerror="this.style.display='none'">
                    </div>
                `;
            } else {
                return `
                    <div class="message-attachment">
                        <a href="${file.url_private}" class="attachment-file" target="_blank">
                            📎 ${file.name}
                        </a>
                    </div>
                `;
            }
        }).join('');
    }

    formatTimestamp(ts) {
        const date = new Date(parseFloat(ts) * 1000);
        return date.toLocaleString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showLoading(message) {
        const messageContainer = document.getElementById('messageContainer');
        messageContainer.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                ${message}
            </div>
        `;
    }

    hideLoading() {
        const messageContainer = document.getElementById('messageContainer');
        // Only clear loading if it's still showing the loading spinner
        if (messageContainer.querySelector('.loading')) {
            messageContainer.innerHTML = `
                <div class="welcome-message">
                    <h3>Archive Loaded Successfully!</h3>
                    <p>Select a channel from the sidebar to start browsing messages.</p>
                </div>
            `;
        }
    }

    buildSearchIndex() {
        this.allMessages = [];
        
        Object.entries(this.messages).forEach(([channelName, messages]) => {
            messages.forEach(message => {
                this.allMessages.push({
                    ...message,
                    channelName: channelName
                });
            });
        });
    }

    handleSearch(query) {
        this.searchQuery = query.trim().toLowerCase();
        const searchAllChannels = document.getElementById('searchAllChannels').checked;
        
        if (!this.searchQuery) {
            this.clearSearch();
            return;
        }

        // Perform search
        this.searchResults = this.performSearch(this.searchQuery, searchAllChannels);
        
        // Update search count
        this.updateSearchCount();
        
        // Render results
        if (searchAllChannels) {
            this.renderSearchResults();
        } else {
            this.renderMessages(this.currentChannel?.name);
        }
    }

    performSearch(query, searchAllChannels) {
        const results = [];
        const searchIn = searchAllChannels ? this.allMessages : (this.messages[this.currentChannel?.name] || []);
        
        searchIn.forEach(message => {
            const searchText = this.getSearchableText(message).toLowerCase();
            if (searchText.includes(query)) {
                results.push(message);
            }
        });
        
        return results;
    }

    getSearchableText(message) {
        const user = this.users[message.user];
        const userName = user ? (user.display_name || user.real_name || user.name) : '';
        const timestamp = this.formatTimestamp(message.ts);
        const messageText = message.text || '';
        
        return `${userName} ${timestamp} ${messageText}`.toLowerCase();
    }

    renderSearchResults() {
        const messageContainer = document.getElementById('messageContainer');
        messageContainer.innerHTML = '';
        
        if (this.searchResults.length === 0) {
            messageContainer.innerHTML = `
                <div class="welcome-message">
                    <p>No messages found matching "${this.searchQuery}"</p>
                </div>
            `;
            return;
        }

        // Group results by channel
        const resultsByChannel = {};
        this.searchResults.forEach(message => {
            const channelName = message.channelName;
            if (!resultsByChannel[channelName]) {
                resultsByChannel[channelName] = [];
            }
            resultsByChannel[channelName].push(message);
        });

        // Render results grouped by channel
        Object.entries(resultsByChannel).forEach(([channelName, messages]) => {
            const channelHeader = document.createElement('div');
            channelHeader.className = 'search-channel-header';
            channelHeader.innerHTML = `
                <h3>#${channelName} (${messages.length} results)</h3>
            `;
            messageContainer.appendChild(channelHeader);

            messages.forEach(message => {
                this.renderMessage(message, false, true);
            });
        });
    }

    clearSearch() {
        this.searchQuery = '';
        this.searchResults = [];
        this.updateSearchCount();
        
        // Clear highlights and show all messages
        document.querySelectorAll('.message').forEach(msg => {
            msg.classList.remove('highlighted', 'hidden');
        });
        
        // Re-render current channel if one is selected
        if (this.currentChannel) {
            this.renderMessages(this.currentChannel.name);
        }
    }

    updateSearchCount() {
        const searchCount = document.getElementById('searchCount');
        if (this.searchQuery && this.searchResults.length > 0) {
            searchCount.textContent = `${this.searchResults.length} results`;
        } else if (this.searchQuery) {
            searchCount.textContent = 'No results';
        } else {
            searchCount.textContent = '';
        }
    }

    isSearchResult(message) {
        return this.searchResults.some(result => result.ts === message.ts && result.user === message.user);
    }

    showError(message) {
        const messageContainer = document.getElementById('messageContainer');
        messageContainer.innerHTML = `
            <div class="welcome-message">
                <h3>Error</h3>
                <p>${message}</p>
            </div>
        `;
    }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new SlackArchiveViewer();
}); 