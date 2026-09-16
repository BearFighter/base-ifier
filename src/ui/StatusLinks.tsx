/**
 * The little cluster at the end of the bottom bar: Discord, optional account
 * sign-in, and the version with its update state.
 */
import { useEffect } from 'react';
import { DISCORD_URL, GITHUB_RELEASES_URL } from '@/app/config';
import { isDesktop, openExternal } from '@/app/desktop';
import { useUpdateStore } from '@/app/updates';
import { useAuthStore } from '@/app/auth';
import { useAppStore } from '@/state/project';

/** Discord's "Clyde" mark (Simple Icons path, CC0). */
function DiscordLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}

export function StatusLinks() {
  const update = useUpdateStore();
  const auth = useAuthStore();
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    const off = update.listen();
    void auth.restore();
    // the desktop shell checks by itself after start; browsers ask GitHub once
    if (!isDesktop()) void update.check();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const versionLabel = `v${update.current}`;
  let updateChip: { text: string; title: string; onClick: () => void; cls: string } | null = null;
  switch (update.state) {
    case 'available':
      updateChip = isDesktop()
        ? { text: `Update ${update.version} downloading…`, title: 'A new version is on its way', onClick: () => {}, cls: 'update' }
        : { text: `Version ${update.version} is out`, title: 'Open the download page', onClick: () => openExternal(update.url ?? GITHUB_RELEASES_URL), cls: 'update' };
      break;
    case 'downloading':
      updateChip = { text: `Update ${update.percent ?? 0}%`, title: 'Downloading the new version', onClick: () => {}, cls: 'update' };
      break;
    case 'ready':
      updateChip = { text: `Restart to update to ${update.version}`, title: 'The new version is downloaded; restart to install it', onClick: () => void update.install(), cls: 'update ready' };
      break;
    case 'error':
      updateChip = { text: 'Update check failed', title: update.message ?? 'Could not check for updates', onClick: () => void update.check(), cls: 'muted' };
      break;
    default:
      updateChip = null;
  }

  return (
    <div className="status-links">
      <a
        className="discord"
        href={DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Join the Base-ifier Discord"
        aria-label="Join the Base-ifier Discord"
        onClick={(e) => {
          e.preventDefault();
          openExternal(DISCORD_URL);
        }}
      >
        <DiscordLogo />
      </a>
      <button
        type="button"
        className={`signin ${auth.status === 'signed-in' ? 'signed' : ''}`}
        title={auth.status === 'signed-in' ? `Signed in as ${auth.user?.email}. Click to manage.` : 'Sign in for paid features (optional)'}
        onClick={() => setView({ showSignIn: true })}
      >
        {auth.status === 'signed-in' ? '✓ Account' : 'Sign in'}
      </button>
      <button
        type="button"
        className="version"
        title={update.state === 'checking' ? 'Checking for updates…' : update.state === 'none' ? 'You have the latest version. Click to check again.' : update.state === 'dev' ? 'Development build' : 'Check for updates'}
        onClick={() => void update.check()}
      >
        {versionLabel}
        {update.state === 'checking' ? ' …' : ''}
      </button>
      {updateChip && (
        <button type="button" className={`update-chip ${updateChip.cls}`} title={updateChip.title} onClick={updateChip.onClick}>
          {updateChip.text}
        </button>
      )}
    </div>
  );
}
