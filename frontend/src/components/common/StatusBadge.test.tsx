/**
 * StatusBadge Component Tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';
import type { DeviceState } from '../../types/device';

describe('StatusBadge', () => {
  const states: Array<{ state: DeviceState; expectedLabel: string }> = [
    { state: 'disconnected', expectedLabel: 'Offline' },
    { state: 'connecting', expectedLabel: 'Csatlakozás...' },
    { state: 'idle', expectedLabel: 'Idle' },
    { state: 'running', expectedLabel: 'Fut' },
    { state: 'paused', expectedLabel: 'Szünet' },
    { state: 'alarm', expectedLabel: 'Alarm' },
    { state: 'homing', expectedLabel: 'Homing' },
    { state: 'probing', expectedLabel: 'Probing' },
    { state: 'jog', expectedLabel: 'Jog' },
  ];

  states.forEach(({ state, expectedLabel }) => {
    it(`should render "${expectedLabel}" label for "${state}" state`, () => {
      render(<StatusBadge state={state} />);
      
      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    });
  });

  it('should apply correct CSS class for idle state', () => {
    render(<StatusBadge state="idle" />);
    
    const badge = screen.getByText('Idle');
    expect(badge).toHaveClass('badge-idle');
  });

  it('should apply correct CSS class for running state', () => {
    render(<StatusBadge state="running" />);
    
    const badge = screen.getByText('Fut');
    expect(badge).toHaveClass('badge-running');
  });

  it('should apply correct CSS class for alarm state', () => {
    render(<StatusBadge state="alarm" />);
    
    const badge = screen.getByText('Alarm');
    expect(badge).toHaveClass('badge-alarm');
  });

  it('should apply correct CSS class for paused state', () => {
    render(<StatusBadge state="paused" />);
    
    const badge = screen.getByText('Szünet');
    expect(badge).toHaveClass('badge-paused');
  });

  it('should apply correct CSS class for disconnected state', () => {
    render(<StatusBadge state="disconnected" />);
    
    const badge = screen.getByText('Offline');
    expect(badge).toHaveClass('badge-disconnected');
  });

  describe('Size variants', () => {
    it('should apply default size styles by default', () => {
      render(<StatusBadge state="idle" />);
      
      const badge = screen.getByText('Idle');
      expect(badge).toHaveClass('badge');
      expect(badge).not.toHaveClass('text-[10px]');
    });

    it('should apply small size styles when size="sm"', () => {
      render(<StatusBadge state="idle" size="sm" />);
      
      const badge = screen.getByText('Idle');
      expect(badge).toHaveClass('text-[10px]');
      expect(badge).toHaveClass('px-1.5');
      expect(badge).toHaveClass('py-0.5');
    });

    it('should not apply small size styles when size="md"', () => {
      render(<StatusBadge state="idle" size="md" />);
      
      const badge = screen.getByText('Idle');
      expect(badge).not.toHaveClass('text-[10px]');
    });
  });

  it('should fallback to disconnected config for unknown state', () => {
    // @ts-expect-error Testing unknown state fallback
    render(<StatusBadge state="unknown_state" />);
    
    const badge = screen.getByText('Offline');
    expect(badge).toHaveClass('badge-disconnected');
  });
});
