const POPUP_TIMEOUT = 30000;

class MendixEmbeddedError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'MendixEmbeddedError';
        this.code = code;
    }
}


export const getMendixUrl = (props) => {
    const url = sessionStorage.getItem('url') ?? props.url ?? props.subPanelContext?.declarativeKeyContext;

    if (url === undefined) {
        return url;
    }

    return url.endsWith('/') ? url : url + '/';
};

export const ensureHasValidSession = async (url) => {
    if (await hasValidSession(url)) {
        return;
    }

    const discriminator = await fetchSessionDiscriminator();
    const ssoUrl = new URL(`rest/tcsso/v1/login?discriminator=${discriminator}`, url);
    await openPopup(ssoUrl);

    if (!await hasValidSession(url)) {
        throw new MendixEmbeddedError('Unable to login to the Mendix application.', 'LOGIN_FAILED');
    }
};

const fetchSessionDiscriminator = async () => {
    try {
        const response = await fetch('/getSessionDiscriminator', {
            headers: {
                Accept: 'text/plain'
            }
        });

        if (!response.ok) {
            throw new Error();
        }

        return await response.text();
    } catch {
        throw new MendixEmbeddedError('Failed to retrieve session discriminator.', 'SESSION_DISCRIMINATOR_ERROR');
    }
};


const hasValidSession = async (url) => {
    try {
        const response = await fetch(new URL('rest/tcsso/v1/validate-session', url), { credentials: 'include' });

        if (response.status === 404) {
            throw new MendixEmbeddedError(
                `Cannot reach the Mendix application at ${url}`,
                'MENDIX_NOT_FOUND'
            );
        }

        if (!response.ok) {
            return false;
        }

        return Boolean(await response.json());
    } catch (error) {
        if (error.code === 'POPUP_BLOCKED' || error.code === 'MENDIX_NOT_FOUND') {
            throw error;
        }

        return false;
    }
};

const openPopup = async (url) => {
    if (!document.hasFocus?.()) {
        await new Promise((resolve) => {
            window.addEventListener('focus', resolve, { once: true });
        });
    }

    const popup = window.open(url, 'Teamcenter SSO', 'width=200,height=300');
    if (!popup) {
        throw new MendixEmbeddedError('Popup blocked.', 'POPUP_BLOCKED');
    }

    popup.focus?.();

    return new Promise((resolve, reject) => {
        let closeTimeoutId;
        let pollTimeoutId;

        const settle = (callback) => {
            window.clearTimeout(closeTimeoutId);
            window.clearTimeout(pollTimeoutId);
            callback();
        };

        const pollForClose = () => {
            if (popup.closed) {
                settle(resolve);
                return;
            }

            pollTimeoutId = window.setTimeout(pollForClose, 200);
        };

        closeTimeoutId = window.setTimeout(() => {
            popup.close();
            settle(() => reject(new MendixEmbeddedError('The sign-in timed out.', 'POPUP_TIMEOUT')));
        }, POPUP_TIMEOUT);

        pollForClose();
    });
};
