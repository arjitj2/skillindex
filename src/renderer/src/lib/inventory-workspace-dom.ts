import { useEffect } from 'react';

export function useCloseOnEscape({
  disabled = false,
  onClose,
}: {
  disabled?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabled) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [disabled, onClose]);
}

export function scrollSelectedInventoryRowIntoView(ariaLabel: string) {
  window.requestAnimationFrame(() => {
    const list = document.querySelector<HTMLElement>(`[aria-label="${ariaLabel}"]`);
    const selectedRow = list?.querySelector<HTMLElement>('.master-list-row--selected');
    selectedRow?.scrollIntoView?.({ block: 'nearest' });
  });
}
