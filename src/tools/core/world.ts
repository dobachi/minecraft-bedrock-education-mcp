import { BaseTool, SequenceStep } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';
import { WeatherType } from 'socket-be';
import { chatBuffer, ChatBuffer } from '../../utils/chat-buffer';
import { eventBuffer } from '../../utils/event-buffer';

/**
 * World管理ツール
 * 時間、天気、ワールド情報の制御に特化
 */
export class WorldTool extends BaseTool {
    readonly name = 'world';
    readonly description = 'World management: control time/weather/environment. Actions: set_time(day/night/specific_time), set_weather(clear/rain/thunder), set_difficulty(peaceful/easy/normal/hard), set_spawn(coordinates), query_info(world_stats). Perfect for setting scene atmosphere, testing conditions, or creating specific environments. Examples: dawn=0, noon=6000, dusk=12000, midnight=18000. Also get_chat: read what players typed in the in-game chat (returns unread messages and marks them read) - use this to actually converse with players, since chat does not reach you on its own. And get_events: read buffered world events such as target block hits (sender is the player, message carries the details, type is the event kind).';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'World management action to perform',
                enum: [
                    'set_time', 'get_time', 'get_day', 'set_weather', 'get_weather',
                    'get_players', 'get_world_info', 'send_message', 'run_command',
                    'get_connection_info', 'get_chat', 'clear_chat', 'get_events', 'clear_events', 'sequence'
                ]
            },
            time: {
                type: 'number',
                description: 'Time in ticks (0-24000, where 0=dawn, 6000=noon, 12000=dusk, 18000=midnight)',
                minimum: 0,
                maximum: 24000
            },
            weather: {
                type: 'string',
                description: 'Weather type to set',
                enum: ['clear', 'rain', 'thunder']
            },
            duration: {
                type: 'number',
                description: 'Weather duration in ticks (optional)',
                minimum: 0
            },
            message: {
                type: 'string',
                description: 'Message to send to all players'
            },
            target: {
                type: 'string',
                description: 'Target player for message (optional, defaults to all players)'
            },
            command: {
                type: 'string',
                description: 'Minecraft Bedrock Edition command to execute (without /). For correct syntax and available commands, use the minecraft_wiki tool to search for specific command information. Examples: "give @p diamond_sword", "tp @p 0 64 0", "setblock ~ ~ ~ stone"'
            },
            limit: {
                type: 'number',
                description: 'Max number of chat messages to return for get_chat (default 50)',
                minimum: 1,
                maximum: 200
            },
            include_read: {
                type: 'boolean',
                description: 'For get_chat and get_events: return recent entries including already-read ones, without advancing the read cursor (default false = unread only)'
            },
            steps: {
                type: 'array',
                description: 'Array of world actions for sequence. Each step should have "type" field and relevant parameters.'
            }
        },
        required: ['action']
    };

    /**
     * ワールド管理操作を実行します
     * 
     * @param args - ワールド操作パラメータ
     * @param args.action - 実行するアクション（set_time, set_weather, get_info等）
     * @param args.time - 時刻設定（0-23999、0=朝6時、12000=夜6時）
     * @param args.weather - 天気タイプ（clear, rain, thunder）
     * @param args.duration - 天気継続時間（秒）
     * @param args.message - ブロードキャストメッセージ
     * @param args.target - メッセージ送信対象（省略時は全プレイヤー）
     * @param args.command - 実行するMinecraftコマンド
     * @param args.limit - get_chat で返す最大件数
     * @param args.include_read - get_chat で既読分も含めるか
     * @returns ツール実行結果
     */
    async execute(args: {
        action: string;
        time?: number;
        weather?: string;
        duration?: number;
        message?: string;
        target?: string;
        command?: string;
        limit?: number;
        include_read?: boolean;
        steps?: SequenceStep[];
    }): Promise<ToolCallResult> {
        // チャット読み出しはバッファ参照のみで、ワールド接続を必要としない
        if (args.action === 'get_chat') return this.getChat(args.limit, args.include_read);
        if (args.action === 'clear_chat') {
            chatBuffer.clear();
            return { success: true, message: 'Chat buffer cleared', data: { action: 'clear_chat', timestamp: Date.now() } };
        }
        if (args.action === 'get_events') return this.getBuffered(eventBuffer, 'get_events', args.limit, args.include_read);
        if (args.action === 'clear_events') {
            eventBuffer.clear();
            return { success: true, message: 'Event buffer cleared', data: { action: 'clear_events', timestamp: Date.now() } };
        }

        if (!this.world) {
            return { success: false, message: 'World not available. Ensure Minecraft is connected.' };
        }

        try {
            const { action } = args;
            let result: any;
            let message: string;

            switch (action) {
                case 'set_time':
                    if (args.time === undefined) return { success: false, message: 'Time required for set_time' };
                    await this.world.setTimeOfDay(args.time);
                    const timeDesc = this.getTimeDescription(args.time);
                    message = `Time set to ${args.time} ticks (${timeDesc})`;
                    break;

                case 'get_time':
                    const currentTime = await this.world.getTimeOfDay();
                    const currentDay = await this.world.getDay();
                    const currentTick = await this.world.getCurrentTick();
                    result = { 
                        timeOfDay: currentTime, 
                        day: currentDay, 
                        totalTicks: currentTick,
                        description: this.getTimeDescription(currentTime)
                    };
                    message = `Current time: ${currentTime} ticks (${this.getTimeDescription(currentTime)}) on day ${currentDay}`;
                    break;

                case 'get_day':
                    result = await this.world.getDay();
                    message = `Current day: ${result}`;
                    break;

                case 'set_weather':
                    if (!args.weather) return { success: false, message: 'Weather required for set_weather' };
                    const weatherType = this.normalizeWeatherType(args.weather);
                    await this.world.setWeather(weatherType, args.duration);
                    message = args.duration ? 
                        `Weather set to ${args.weather} for ${args.duration} ticks` :
                        `Weather set to ${args.weather}`;
                    break;

                case 'get_weather':
                    result = await this.world.getWeather();
                    message = `Current weather: ${result}`;
                    break;

                case 'get_players':
                    const players = await this.world.getPlayers();
                    const playerInfo = players.map(p => ({ name: p.name, isLocal: p.isLocalPlayer }));
                    result = playerInfo;
                    message = `Found ${players.length} players online`;
                    break;

                case 'get_world_info':
                    result = {
                        name: this.world.name,
                        connectedAt: this.world.connectedAt,
                        averagePing: this.world.averagePing,
                        maxPlayers: this.world.maxPlayers,
                        isValid: this.world.isValid
                    };
                    message = `World info retrieved: ${this.world.name}`;
                    break;

                case 'send_message':
                    if (!args.message) return { success: false, message: 'Message required for send_message' };
                    await this.world.sendMessage(args.message, args.target);
                    message = args.target ? 
                        `Message sent to ${args.target}: "${args.message}"` :
                        `Message sent to all players: "${args.message}"`;
                    break;

                case 'run_command':
                    if (!args.command) return { success: false, message: 'Command required for run_command' };
                    result = await this.world.runCommand(args.command);
                    message = `Command executed: ${args.command}`;
                    break;

                case 'get_connection_info':
                    result = {
                        averagePing: this.world.averagePing,
                        connectedAt: this.world.connectedAt,
                        maxPlayers: this.world.maxPlayers,
                        isValid: this.world.isValid
                    };
                    message = 'Connection info retrieved';
                    break;

                case 'sequence':
                    if (!args.steps) {
                        return this.createErrorResponse('steps array is required for sequence action');
                    }
                    return await this.executeSequence(args.steps as SequenceStep[]);

                default:
                    return { success: false, message: `Unknown action: ${action}` };
            }

            return {
                success: true,
                message: message,
                data: { action, result, timestamp: Date.now() }
            };

        } catch (error) {
            return {
                success: false,
                message: `World management error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * バッファに溜まったゲーム内チャットを取り出します
     *
     * 既定では未読分のみを返し、返した分を既読にします。
     * include_read=true の場合は直近のログを既読カーソルを動かさずに返します。
     *
     * @param limit - 返す最大件数（既定50）
     * @param includeRead - 既読分も含めるか
     */
    private getChat(limit: number = 50, includeRead: boolean = false): ToolCallResult {
        return this.getBuffered(chatBuffer, 'get_chat', limit, includeRead);
    }

    /**
     * リングバッファの中身を取り出す共通処理（チャットとイベントで共有）
     *
     * @param buffer - 対象のバッファ
     * @param action - 応答に載せるアクション名
     * @param limit - 返す最大件数（既定50）
     * @param includeRead - 既読分も含めるか
     */
    private getBuffered(buffer: ChatBuffer, action: string, limit: number = 50, includeRead: boolean = false): ToolCallResult {
        const max = Math.min(Math.max(limit ?? 50, 1), 200);
        const entries = includeRead ? buffer.getRecent(max) : buffer.getUnread(max);

        if (!includeRead && entries.length > 0) {
            buffer.markRead(entries[entries.length - 1].id);
        }

        const label = action === 'get_events' ? 'event' : 'chat message';
        const message = entries.length === 0
            ? (includeRead ? `No ${label}s buffered` : `No new ${label}s`)
            : `${entries.length} ${label}(s)`;

        return {
            success: true,
            message,
            data: {
                action,
                result: entries.map(e => ({
                    time: new Date(e.timestamp).toISOString(),
                    sender: e.sender,
                    message: e.message,
                    type: e.type
                })),
                unreadRemaining: buffer.unreadCount,
                timestamp: Date.now()
            }
        };
    }

    private getTimeDescription(ticks: number): string {
        if (ticks >= 0 && ticks < 1000) return 'Dawn';
        if (ticks >= 1000 && ticks < 5000) return 'Morning';
        if (ticks >= 5000 && ticks < 7000) return 'Noon';
        if (ticks >= 7000 && ticks < 11000) return 'Afternoon';
        if (ticks >= 11000 && ticks < 13000) return 'Dusk';
        if (ticks >= 13000 && ticks < 17000) return 'Night';
        if (ticks >= 17000 && ticks < 19000) return 'Midnight';
        return 'Late Night';
    }

    private normalizeWeatherType(weather: string): WeatherType {
        switch (weather.toLowerCase()) {
            case 'clear':
                return WeatherType.Clear;
            case 'rain':
                return WeatherType.Rain;
            case 'thunder':
                return WeatherType.Thunder;
            default:
                return WeatherType.Clear;
        }
    }

    /**
     * ワールド専用のシーケンスステップ実行
     * 
     * @param step - 実行するステップ
     * @param index - ステップのインデックス
     * @returns ステップ実行結果
     * 
     * @protected
     * @override
     */
    protected async executeSequenceStep(step: SequenceStep, index: number): Promise<ToolCallResult> {
        // wait ステップは基底クラスで処理される
        if (step.type === 'wait') {
            return await super.executeSequenceStep(step, index);
        }

        // ワールド特有のステップを実行
        const worldArgs = { action: step.type, ...step };
        return await this.execute(worldArgs);
    }
}