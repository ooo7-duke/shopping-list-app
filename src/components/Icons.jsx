const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', 'aria-hidden': true };
const I = (paths) => function Icon(props) {
  return <svg {...base} {...props}>{paths}</svg>;
};

export const ListIcon = I(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></>);
export const CartIcon = I(<><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M3 4h2l2.4 11h11.2L21 8H6.2" /></>);
export const ReceiptIcon = I(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>);
export const ChartIcon = I(<><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>);
export const MicIcon = I(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>);
export const PlusIcon = I(<path d="M12 5v14M5 12h14" />);
export const MenuIcon = I(<path d="M4 5h16M4 10h16M4 15h16M4 20h16" />);
export const ChevronDown = I(<path d="M6 9l6 6 6-6" />);
export const ClockIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const TrashIcon = I(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const CameraIcon = I(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>);
export const CloseIcon = I(<path d="M6 6l12 12M18 6L6 18" />);
export const CheckIcon = I(<path d="M5 12l5 5 9-10" />);
export const TruckIcon = I(<><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>);
export const DownloadIcon = I(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>);
export const LogoMark = (props) => (
  <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
    <rect width="48" height="48" rx="12" style={{ fill: 'var(--bb, #243b8f)' }} />
    <path d="M12 15h3l3.5 15h14l3.5-10H17" fill="none" style={{ stroke: 'var(--cream, #fdf1c9)' }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="20" cy="35" r="2.5" style={{ fill: 'var(--gold, #ffc20d)' }} /><circle cx="31" cy="35" r="2.5" style={{ fill: 'var(--gold, #ffc20d)' }} />
  </svg>
);
