import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="header-content">
          <div className="header-left">
            <div className="brand-mark" />
            <div>
              <p className="brand-kicker">Confidential swaps</p>
              <span className="brand-title">StealthSwap</span>
            </div>
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
