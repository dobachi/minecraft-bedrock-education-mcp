/**
 * ゲーム内チャットのリングバッファ
 *
 * MCP はプル型（AIクライアントが呼んだ時だけ動く）なので、
 * Minecraft から届いたチャットはいったんここに溜めておき、
 * `world get_chat` ツールで後から取り出す。
 *
 * 未読カーソル（lastReadId）を持ち、既定では未読分だけを返す。
 */

/** チャット1件 */
export interface ChatEntry {
    /** 単調増加のシーケンス番号（未読管理に使う） */
    id: number;
    /** 受信時刻（epoch ms） */
    timestamp: number;
    /** 発言者名 */
    sender: string;
    /** 本文 */
    message: string;
    /** 種別: chat（通常発言） / say / me / tell */
    type: string;
}

/** 1メッセージあたりの保持上限（文字数）。超過分は切り詰める */
const MAX_MESSAGE_LENGTH = 512;
/** 発言者名の保持上限（文字数） */
const MAX_SENDER_LENGTH = 64;

export class ChatBuffer {
    private entries: ChatEntry[] = [];
    private nextId = 1;
    private lastReadId = 0;

    /**
     * @param capacity 保持する最大件数。溢れたら古いものから捨てる
     *
     * メモリ使用量は capacity × MAX_MESSAGE_LENGTH で上限が決まる
     * （既定で約 200 × 512 文字 ≒ 200KB）。誰も読み出さないまま
     * 放置されても、この上限を超えて増えることはない。
     */
    constructor(private readonly capacity: number = 200) {}

    /** チャットを1件記録する */
    add(sender: string, message: string, type: string = 'chat'): ChatEntry {
        // Player/World オブジェクトは保持せず、文字列だけを長さ制限付きで持つ
        // （イベントオブジェクトを溜めるとワールド全体が GC されなくなる）
        const entry: ChatEntry = {
            id: this.nextId++,
            timestamp: Date.now(),
            sender: truncate(sender, MAX_SENDER_LENGTH),
            message: truncate(message, MAX_MESSAGE_LENGTH),
            type
        };
        this.entries.push(entry);
        if (this.entries.length > this.capacity) {
            this.entries.splice(0, this.entries.length - this.capacity);
        }
        return entry;
    }

    /** 未読（前回の取得以降）のチャットを返す。古い順 */
    getUnread(limit: number = 50): ChatEntry[] {
        return this.entries.filter(e => e.id > this.lastReadId).slice(-limit);
    }

    /** 既読・未読を問わず直近のチャットを返す。古い順 */
    getRecent(limit: number = 50): ChatEntry[] {
        return this.entries.slice(-limit);
    }

    /** 指定IDまでを既読にする（省略時は全件既読） */
    markRead(upToId?: number): void {
        const target = upToId ?? this.latestId;
        if (target > this.lastReadId) {
            this.lastReadId = target;
        }
    }

    /** バッファを空にし、未読カーソルも戻す */
    clear(): void {
        this.entries = [];
        this.lastReadId = 0;
    }

    /** 保持している最新のID（0 = 未受信） */
    get latestId(): number {
        return this.entries.length > 0 ? this.entries[this.entries.length - 1].id : 0;
    }

    /** 未読件数 */
    get unreadCount(): number {
        return this.entries.filter(e => e.id > this.lastReadId).length;
    }

    /** 保持件数 */
    get size(): number {
        return this.entries.length;
    }
}

/** 長すぎる文字列を切り詰める（切り詰めた場合は末尾に印を付ける） */
function truncate(value: string, max: number): string {
    if (typeof value !== 'string') return '';
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * プロセス全体で共有するインスタンス。
 * server.ts が書き込み、WorldTool が読み出す。
 */
export const chatBuffer = new ChatBuffer();
