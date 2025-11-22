/* eslint-disable no-tabs */
import { WOLF } from 'wolf.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { updateEvents } from './utils/constants/updateEvents.js';

/**
 * Extended WOLF class with custom bot management features
 */
class CustomWOLF extends WOLF {
	constructor(botManager = null, botType = 'main') {
		super();
		this.botManager = botManager;
		this.botType = botType;
		this.connected = false;
		this.isBusy = false;
		this.isWorking = false;
	}

	/**
	 * Set the busy state of the bot
	 */
	setIsBusy(isBusy) {
		this.isBusy = isBusy;
	}

	/**
	 * Set the working state of the bot
	 */
	setIsWorking(isWorking) {
		this.isWorking = isWorking;
	}

	/**
	 * Create a proxy agent based on configuration
	 * @returns {HttpsProxyAgent|SocksProxyAgent|undefined}
	 */
	createProxyAgent() {
		const proxyConfig = this._loginConfig?.proxy || this.config?.proxy;

		if (!proxyConfig || !proxyConfig.enabled) {
			return undefined;
		}

		const { protocol, host, port, username, password } = proxyConfig;

		if (!host || !port) {
			console.warn('Proxy enabled but host or port missing');
			return undefined;
		}

		try {
			let proxyUrl = `${protocol}://`;

			if (username && password) {
				proxyUrl += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
			}

			proxyUrl += `${host}:${port}`;

			if (protocol === 'socks5' || protocol === 'socks') {
				return new SocksProxyAgent(proxyUrl);
			} else {
				return new HttpsProxyAgent(proxyUrl);
			}
		} catch (error) {
			console.error('Failed to create proxy agent:', error);
			return undefined;
		}
	}

	/**
	 * Override login to handle connection state
	 */
	async login(config) {
		// Return a promise that waits for the actual connection
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				cleanup();
				this.connected = false;
				reject(new Error('Connection timeout after 15 seconds'));
			}, 15000);

			const handleReady = (data) => {
				clearTimeout(timeoutId);
				this.connected = true;
				this.currentSubscriber = data?.loggedInUser || this.currentSubscriber;
				cleanup();
				resolve(data);
			};

			const handleError = (error) => {
				clearTimeout(timeoutId);
				this.connected = false;
				cleanup();
				reject(error instanceof Error ? error : new Error(String(error)));
			};

			const cleanup = () => {
				this.off('ready', handleReady);
				this.off('resume', handleReady);
				this.off('connectionError', handleError);
				this.off('connectError', handleError);
			};

			// Listen for welcome event to log user info
			this.once('welcome', (welcome) => {
				console.log('🎉 Bot connected successfully:', {
					botType: this.botType,
					subscriberId: welcome.subscriber?.id,
					nickname: welcome.subscriber?.nickname,
					status: welcome.subscriber?.status,
					deviceType: welcome.deviceType
				});
				// Notify UI based on bot type using standard events
				if (this.botManager?.socket) {
					const eventMap = {
						main: updateEvents.bots.main.connected,
						room: updateEvents.bots.room.connected,
						ad: updateEvents.bots.ad.connected
					};

					const eventName = eventMap[this.botType];
					if (eventName) {
						this.botManager.socket.emit(eventName, {
							subscriber: {
								id: welcome.subscriber?.id,
								nickname: welcome.subscriber?.nickname
							}
						});
					}
				}
			});

			// Listen for events that WOLF emits (both ready and resume)
			this.once('ready', handleReady);
			this.once('resume', handleReady);
			this.once('connectionError', handleError);
			this.once('connectError', handleError);

			// Call parent login which sets up websocket and connects
			super.login(config).catch((error) => {
				clearTimeout(timeoutId);
				cleanup();
				this.connected = false;
				reject(error);
			});
		});
	}

	/**
	 * Override disconnect to update connection state and notify UI
	 */
	async disconnect() {
		try {
			console.log(`🔌 Disconnecting bot: { botType: '${this.botType}', subscriberId: ${this.currentSubscriber?.id}, nickname: '${this.currentSubscriber?.nickname}' }`);
			await super.disconnect();
		} finally {
			this.connected = false;

			// Notify UI based on bot type
			if (this.botManager?.socket) {
				const eventMap = {
					main: updateEvents.bots.main.disconnected,
					room: updateEvents.bots.room.disconnected,
					ad: updateEvents.bots.ad.disconnected
				};

				const eventName = eventMap[this.botType];
				if (eventName) {
					this.botManager.socket.emit(eventName, {
						subscriber: {
							id: this.currentSubscriber?.id,
							nickname: this.currentSubscriber?.nickname
						}
					});
				}
			}
		}
	}

	/**
	 * Setup message routing for ad or magic bot type
	 * @param {Object} handlers - Object with handlers for different bot types
	 * @param {Function} handlers.ad - Handler for ad bot type
	 * @param {Function} handlers.magic - Handler for magic bot type
	 */
	setupMessageRouting(handlers) {
		if (this.botType !== 'main') {
			return; // Only main bot handles message routing
		}

		// Listen for all messages (private and group)
		this.on('message', async (message) => {
			try {
				const botType = this.botManager?.getBotType?.();
				if (!botType) { return; }

				const adminId = this.botManager?.config?.baseConfig?.orderFrom;
				// Convert adminId to number for comparison
				if (!adminId || parseInt(adminId) !== message.sourceSubscriberId) { return; }

				// Route to appropriate handler based on bot type
				if (botType === 'ad' && handlers.ad) {
					await handlers.ad(message, { botManager: this.botManager });
				} else if (botType === 'magic' && handlers.magic) {
					await handlers.magic(message, { botManager: this.botManager });
				}
			} catch (error) {
				console.error('Error handling message:', error);
			}
		});
	}
}

export default CustomWOLF;
