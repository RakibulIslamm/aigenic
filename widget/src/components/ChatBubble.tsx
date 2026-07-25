interface ChatBubbleProps {
  onClick: () => void;
  primaryColor: string;
  open: boolean;
}

export function ChatBubble({ onClick, primaryColor, open }: ChatBubbleProps) {
  return (
    <button
      type="button"
      class={`ad-bubble ${open ? 'is-open' : ''}`}
      style={{ background: primaryColor }}
      onClick={onClick}
      aria-label={open ? 'Close chat' : 'Open chat'}
      aria-expanded={open}
    >
      <svg
        class="ad-bubble-icon ad-bubble-icon-chat"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      <svg
        class="ad-bubble-icon ad-bubble-icon-close"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
