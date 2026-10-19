// 線條圖示（inline SVG，跟隨文字顏色）。裝飾用途一律 aria-hidden。
const paths: Record<string, React.ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  video: (<><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>),
  alert: (<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>),
  list: (<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  money: (<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />),
  building: (<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />),
  chart: (<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>),
  lock: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  check: (<path d="M20 6L9 17l-5-5" />),
  chevronLeft: (<path d="M15 18l-6-6 6-6" />),
  chevronRight: (<path d="M9 18l6-6-6-6" />),
  logo: (<path d="M7 20V4h6a5 5 0 0 1 0 10H7" />),
};

export function Icon({ name, size = 18, strokeWidth = 1.8 }: { name: keyof typeof paths | string; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
