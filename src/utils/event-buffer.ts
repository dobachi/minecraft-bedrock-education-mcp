/**
 * ワールドイベントのリングバッファ
 *
 * チャットと同じ理由でバッファを挟む。MCP はプル型なので、イベントが届いた
 * 瞬間に渡す先がない。いったん溜めておき `world get_events` で取り出す。
 *
 * 構造は ChatBuffer をそのまま使う。フィールドの意味だけ読み替える。
 *
 *   sender  … イベントを起こしたプレイヤー名
 *   message … イベントの内容（例: "level=12 from (130,128,-137)"）
 *   type    … イベント種別（例: "target"）
 */
import { ChatBuffer } from './chat-buffer';

export const eventBuffer = new ChatBuffer(200);
