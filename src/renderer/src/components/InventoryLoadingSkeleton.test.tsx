import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  HomeInventoryLoadingSkeleton,
  InventoryListLoadingSkeleton,
} from './InventoryLoadingSkeleton';

describe('InventoryLoadingSkeleton', () => {
  it('announces one concise loading status for the Home skeleton', () => {
    const { container } = render(<HomeInventoryLoadingSkeleton />);

    expect(screen.getByRole('status', { name: 'Scanning local inventory' })).toBeInTheDocument();
    expect(container.querySelectorAll('.inventory-skeleton__metric')).toHaveLength(3);
    expect(container.querySelectorAll('.inventory-skeleton__row')).toHaveLength(3);
  });

  it('renders a layout-shaped inventory list without exposing decorative rows', () => {
    const { container } = render(<InventoryListLoadingSkeleton />);

    expect(screen.getByRole('status', { name: 'Scanning local inventory' })).toBeInTheDocument();
    expect(container.querySelectorAll('.inventory-skeleton__section')).toHaveLength(2);
    expect(container.querySelectorAll('.inventory-skeleton__row')).toHaveLength(6);
    expect(container.querySelectorAll('[aria-hidden="true"] .inventory-skeleton__row')).toHaveLength(6);
  });
});
