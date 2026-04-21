/**
 * StatusBadge Component Tests
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';
import type { DeviceState } from '../../types/device';
import { renderWithProviders } from '../../test/renderWithProviders';

describe('StatusBadge', () => {
  const states: Array<{ state: DeviceState; expectedLabel: string }> = [
    { state: 'disconnected', expectedLabel: 'Offline' },
    { state: 'connecting', expectedLabel: 'Connecting…' },
    { state: 'idle', expectedLabel: 'Idle' },
    { state: 'running', expectedLabel: 'Running' },
    { state: 'paused', expectedLabel: 'Paused' },
    { state: 'alarm', expectedLabel: 'Alarm' },
    { state: 'homing', expectedLabel: 'Homing' },
    { state: 'probing', expectedLabel: 'Probing' },
    { state: 'jog', expectedLabel: 'Jog' },
  ];

  states.forEach(({ state, expectedLabel }) => {
    it(`should render "${expectedLabel}" label for "${state}" state`, () => {
      renderWithProviders(<StatusBadge state={state} />);

      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    });
  });

  it('should apply correct CSS class for idle state', () => {
    renderWithProviders(<StatusBadge state="idle" />);

    const badge = screen.getByText('Idle');
    expect(badge).toHaveClass('badge-idle');
  });

  it('should apply correct CSS class for running state', () => {
    renderWithProviders(<StatusBadge state="running" />);

    const badge = screen.getByText('Running');
    expect(badge).toHaveClass('badge-running');
  });

  it('should apply correct CSS class for alarm state', () => {
    renderWithProviders(<StatusBadge state="alarm" />);

    const badge = screen.getByText('Alarm');
    expect(badge).toHaveClass('badge-alarm');
  });

  it('should apply correct CSS class for paused state', () => {
    renderWithProviders(<StatusBadge state="paused" />);

    const badge = screen.getByText('Paused');
    expect(badge).toHaveClass('badge-paused');
  });

  it('should apply correct CSS class for disconnected state', () => {
    renderWithProviders(<StatusBadge state="disconnected" />);

    const badge = screen.getByText('Offline');
    expect(badge).toHaveClass('badge-disconnected');
  });

  describe('Size variants', () => {
    it('should apply default size styles by default', () => {
      renderWithProviders(<StatusBadge state="idle" />);

      const badge = screen.getByText('Idle');
      expect(badge).toHaveClass('badge');
      expect(badge).not.toHaveClass('text-[10px]');
    });

    it('should apply small size styles when size="sm"', () => {
      renderWithProviders(<StatusBadge state="idle" size="sm" />);

      const badge = screen.getByText('Idle');
      expect(badge).toHaveClass('text-[10px]');
      expect(badge).toHaveClass('px-1.5');
      expect(badge).toHaveClass('py-0.5');
    });

    it('should not apply small size styles when size="md"', () => {
      renderWithProviders(<StatusBadge state="idle" size="md" />);

      const badge = screen.getByText('Idle');
      expect(badge).not.toHaveClass('text-[10px]');
    });
  });

  it('should fallback to disconnected config for unknown state', () => {
    // @ts-expect-error Testing unknown state fallback
    renderWithProviders(<StatusBadge state="unknown_state" />);

    const badge = screen.getByText('Offline');
    expect(badge).toHaveClass('badge-disconnected');
  });
});
