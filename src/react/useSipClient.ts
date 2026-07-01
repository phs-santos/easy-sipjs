import { useState, useEffect, useRef, useCallback } from 'react';
import { SipClient, SipClientOptions } from '../index.js';
import { SipCredentials, SipConnectionState, SipInvitation } from '../core/types.js';
import { ISipSession } from '../core/provider.js';

export interface UseSipClientReturn {
    client: SipClient;
    connectionState: SipConnectionState;
    activeSession: ISipSession | undefined;
    incomingInvitation: SipInvitation | undefined;
    acceptCall: (options?: { video?: boolean }) => Promise<ISipSession | undefined>;
    rejectCall: () => Promise<void>;
}

export function useSipClient(
    credentials: SipCredentials,
    options?: SipClientOptions
): UseSipClientReturn {
    const [client] = useState(() => new SipClient(credentials, options));
    const [connectionState, setConnectionState] = useState<SipConnectionState>('disconnected');
    const [activeSession, setActiveSession] = useState<ISipSession | undefined>(undefined);
    const [incomingInvitation, setIncomingInvitation] = useState<SipInvitation | undefined>(undefined);
    const remoteRef = useRef<HTMLAudioElement | null>(null);

    // Stable key derived from identity-relevant fields; changing any of these
    // triggers a full re-registration with the new credentials.
    const credentialsKey = JSON.stringify({
        domain: credentials.domain,
        phone: credentials.phone,
        server: credentials.server,
        authorizationUsername: credentials.authorizationUsername,
        provider: options?.provider,
    });

    useEffect(() => {
        client.onConnectionStateChange = setConnectionState;

        client.onUserAgent.onInvite = (invitation) => {
            setIncomingInvitation(invitation);
            const originalOnTerminate = invitation.onTerminate;
            invitation.onTerminate = () => {
                setIncomingInvitation(undefined);
                if (originalOnTerminate) originalOnTerminate();
            };
        };

        client.updateCredentials(credentials).catch(err => console.error('[easy-sipjs] Registration failed:', err));

        return () => {
            client.unregister().catch(console.error);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [credentialsKey]);

    const acceptCall = useCallback(async (opts?: { video?: boolean }): Promise<ISipSession | undefined> => {
        if (!incomingInvitation) return undefined;

        if (!remoteRef.current) {
            remoteRef.current = new Audio();
            remoteRef.current.autoplay = true;
        }

        const session = await client.answer(incomingInvitation, {
            remoteElement: remoteRef.current,
            video: opts?.video ?? false,
        });

        setActiveSession(session);
        setIncomingInvitation(undefined);

        const originalOnTerminate = session.onTerminate;
        session.onTerminate = () => {
            setActiveSession(undefined);
            if (originalOnTerminate) originalOnTerminate();
        };

        return session;
    }, [client, incomingInvitation]);

    const rejectCall = useCallback(async (): Promise<void> => {
        if (!incomingInvitation) return;
        await incomingInvitation.reject();
        setIncomingInvitation(undefined);
    }, [incomingInvitation]);

    return { client, connectionState, activeSession, incomingInvitation, acceptCall, rejectCall };
}
