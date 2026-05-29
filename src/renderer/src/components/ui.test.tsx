import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CalloutCard, InventoryListRow } from './ui';

describe('CalloutCard', () => {
  it('shows a warning icon for attention tone', () => {
    const { container } = render(
      <CalloutCard tone="attention" title="Needs attention">
        This skill has drift.
      </CalloutCard>,
    );

    const icon = container.querySelector('.callout-card-icon');
    expect(icon).not.toBeNull();
    expect(icon).toHaveTextContent('!');
    expect(container.querySelector('.callout-card')).not.toHaveClass('callout-card--iconless');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('hides the warning icon for healthy tone', () => {
    const { container } = render(
      <CalloutCard tone="healthy" title="Healthy across installed locations">
        This skill looks consistent across installed locations.
      </CalloutCard>,
    );

    expect(container.querySelector('.callout-card')).toHaveClass('callout-card--iconless');
    expect(container.querySelector('.callout-card-icon')).toBeNull();
    expect(screen.getByText('Healthy across installed locations')).toBeInTheDocument();
  });
});

describe('InventoryListRow', () => {
  it('renders the plugin help text in a real tooltip when the plugin icon is hovered', () => {
    render(
      <InventoryListRow
        badges={[{ label: 'Needs Attention', tone: 'attention' }]}
        isLocked
        isSelected={false}
        lockedTooltip="This skill was installed via one or more plugins"
        name="brainstorming"
        onClick={() => {}}
      />,
    );

    fireEvent.mouseEnter(screen.getByLabelText('This skill was installed via one or more plugins'));

    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'This skill was installed via one or more plugins',
    );
  });
});
