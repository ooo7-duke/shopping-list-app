import { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons.jsx';

// Bottom sheet on phones, centered dialog on wider screens. Escape or tapping outside closes it.
export default function Sheet({ title, onClose, children, wide }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1} style={wide ? { maxWidth: 820 } : undefined}>
        <div className="grab" />
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 className="grow">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
