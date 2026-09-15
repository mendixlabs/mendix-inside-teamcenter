// Jest's jsdom predates throwIfAborted(), which the supported browsers provide.
if ( !AbortSignal.prototype.throwIfAborted ) {
    Object.defineProperty( AbortSignal.prototype, 'throwIfAborted', {
        configurable: true,
        writable: true,
        value() {
            if ( this.aborted ) {
                throw this.reason;
            }
        }
    } );
}
