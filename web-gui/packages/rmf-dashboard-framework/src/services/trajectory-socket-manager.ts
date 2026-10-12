import EventEmitter from 'eventemitter3';

type Events = {
  updated: [];
};

export default class TrajectorySocketManager extends EventEmitter<Events> {
  private _ongoingRequest: Promise<MessageEvent> | null = null;

  private _listenOnce<K extends keyof WebSocketEventMap>(
    event: K,
    webSocket: WebSocket,
    listener: (e: WebSocketEventMap[K]) => unknown,
  ): void {
    webSocket.addEventListener(event, (e) => {
      webSocket.removeEventListener(event, listener);
      listener(e);
    });
  }

  /**
   * Sends a message and waits for response from the server.
   *
   * @remarks This is an alternative to the old implementation of creating a promise, storing the
   * resolver and processing each message in an event loop. Advantage of this is that each message
   * processing logic can be self-contained without a need for a switch or if elses.
   */
  protected async send(
    payload: WebSocketSendParam0T,
    webSocket: WebSocket | undefined,
  ): Promise<MessageEvent> {
    if (!webSocket) throw Error('Websocket not initialized!');
    await this._waitOpen(webSocket);
    // Wait for any in-flight request before sending the next one so replies
    // stay ordered (schedule_visualizer is strictly request/response).
    if (this._ongoingRequest) {
      await this._ongoingRequest;
    }

    this._ongoingRequest = new Promise((res, rej) => {
      const onError = () => {
        this._ongoingRequest = null;
        rej(new Error('trajectory websocket error'));
      };
      const onClose = () => {
        this._ongoingRequest = null;
        rej(new Error('trajectory websocket closed'));
      };
      webSocket.addEventListener('error', onError, { once: true });
      webSocket.addEventListener('close', onClose, { once: true });
      this._listenOnce('message', webSocket, (e) => {
        webSocket.removeEventListener('error', onError);
        webSocket.removeEventListener('close', onClose);
        this._ongoingRequest = null;
        res(e);
      });
      try {
        webSocket.send(payload);
      } catch (err) {
        webSocket.removeEventListener('error', onError);
        webSocket.removeEventListener('close', onClose);
        this._ongoingRequest = null;
        rej(err);
      }
    });
    return this._ongoingRequest;
  }

  private _waitOpen(webSocket: WebSocket): Promise<void> {
    if (webSocket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (
      webSocket.readyState === WebSocket.CLOSING ||
      webSocket.readyState === WebSocket.CLOSED
    ) {
      return Promise.reject(new Error('trajectory websocket is closed'));
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('trajectory websocket open timeout'));
      }, 10000);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('trajectory websocket failed to open'));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        webSocket.removeEventListener('open', onOpen);
        webSocket.removeEventListener('error', onError);
      };
      webSocket.addEventListener('open', onOpen);
      webSocket.addEventListener('error', onError);
    });
  }
}

type WebSocketSendParam0T = Parameters<WebSocket['send']>[0];
