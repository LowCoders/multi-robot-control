/**
 * DeviceCard Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import DeviceCard from './DeviceCard';
import type { Device, DeviceStatus } from '../../types/device';

// Mock the device store
const mockSendCommand = vi.fn();
vi.mock('../../stores/deviceStore', () => ({
  useDeviceStore: () => ({
    sendCommand: mockSendCommand,
  }),
}));

const mockStatus: DeviceStatus = {
  state: 'idle',
  position: { x: 100, y: 200, z: 50 },
  work_position: { x: 100, y: 200, z: 50 },
  feed_rate: 1000,
  spindle_speed: 5000,
  laser_power: 0,
  progress: 0,
  current_line: 0,
  total_lines: 0,
  current_file: 'test.nc',
  error_message: null,
  feed_override: 100,
  spindle_override: 100,
};

const createDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'cnc-main',
  name: 'Main CNC',
  type: 'cnc_mill',
  driver: 'linuxcnc',
  connected: true,
  state: 'idle',
  status: mockStatus,
  ...overrides,
});

const renderWithRouter = (ui: React.ReactElement) => {
  return render(
    <BrowserRouter>{ui}</BrowserRouter>
  );
};

describe('DeviceCard', () => {
  beforeEach(() => {
    mockSendCommand.mockClear();
  });

  describe('Rendering', () => {
    it('should render device name', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.getByText('Main CNC')).toBeInTheDocument();
    });

    it('should render driver name', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.getByText('LINUXCNC')).toBeInTheDocument();
    });

    it('should render status badge', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'idle' })} />);
      
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('should render position display when status exists', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.getByText('100.000')).toBeInTheDocument();
      expect(screen.getByText('200.000')).toBeInTheDocument();
      expect(screen.getByText('50.000')).toBeInTheDocument();
    });

    it('should render feed rate', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.getByText('1000 mm/min')).toBeInTheDocument();
    });

    it('should render spindle speed when greater than zero', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.getByText('5000 RPM')).toBeInTheDocument();
    });

    it('should render laser power when greater than zero', () => {
      const laserDevice = createDevice({
        type: 'laser_cutter',
        status: { ...mockStatus, laser_power: 80, spindle_speed: 0 },
      });
      renderWithRouter(<DeviceCard device={laserDevice} />);
      
      expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('should render details link', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      const link = screen.getByText('Részletek →');
      expect(link).toHaveAttribute('href', '/device/cnc-main');
    });
  });

  describe('Progress display', () => {
    it('should show progress bar when running', () => {
      const runningDevice = createDevice({
        state: 'running',
        status: { ...mockStatus, state: 'running', progress: 45 },
      });
      renderWithRouter(<DeviceCard device={runningDevice} />);
      
      expect(screen.getByText('Haladás')).toBeInTheDocument();
      expect(screen.getByText('45.0%')).toBeInTheDocument();
    });

    it('should not show progress bar when idle', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.queryByText('Haladás')).not.toBeInTheDocument();
    });
  });

  describe('Error display', () => {
    it('should show error message when in alarm state', () => {
      const alarmDevice = createDevice({
        state: 'alarm',
        status: { ...mockStatus, state: 'alarm', error_message: 'Emergency stop activated' },
      });
      renderWithRouter(<DeviceCard device={alarmDevice} />);
      
      expect(screen.getByText('Emergency stop activated')).toBeInTheDocument();
    });

    it('should not show error when not in alarm state', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.queryByText('Emergency stop activated')).not.toBeInTheDocument();
    });
  });

  describe('Control buttons', () => {
    it('should render home button', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      expect(screen.getByTitle('Home')).toBeInTheDocument();
    });

    it('should enable home button when idle', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'idle' })} />);
      
      expect(screen.getByTitle('Home')).not.toBeDisabled();
    });

    it('should disable home button when not idle', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'running' })} />);
      
      expect(screen.getByTitle('Home')).toBeDisabled();
    });

    it('should show play button when idle', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'idle' })} />);
      
      expect(screen.getByTitle('Start')).toBeInTheDocument();
    });

    it('should show pause button when running', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'running' })} />);
      
      expect(screen.getByTitle('Pause')).toBeInTheDocument();
    });

    it('should show resume button when paused', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'paused' })} />);
      
      expect(screen.getByTitle('Resume')).toBeInTheDocument();
    });

    it('should show stop button when running', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'running' })} />);
      
      expect(screen.getByTitle('Stop')).toBeInTheDocument();
    });

    it('should show stop button when paused', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'paused' })} />);
      
      expect(screen.getByTitle('Stop')).toBeInTheDocument();
    });

    it('should show reset button when in alarm', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'alarm' })} />);
      
      expect(screen.getByTitle('Reset')).toBeInTheDocument();
    });
  });

  describe('Command handling', () => {
    it('should call sendCommand with home when home button clicked', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      fireEvent.click(screen.getByTitle('Home'));
      
      expect(mockSendCommand).toHaveBeenCalledWith('cnc-main', 'home');
    });

    it('should call sendCommand with run when play button clicked', () => {
      renderWithRouter(<DeviceCard device={createDevice()} />);
      
      fireEvent.click(screen.getByTitle('Start'));
      
      expect(mockSendCommand).toHaveBeenCalledWith('cnc-main', 'run');
    });

    it('should call sendCommand with pause when pause button clicked', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'running' })} />);
      
      fireEvent.click(screen.getByTitle('Pause'));
      
      expect(mockSendCommand).toHaveBeenCalledWith('cnc-main', 'pause');
    });

    it('should call sendCommand with resume when resume button clicked', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'paused' })} />);
      
      fireEvent.click(screen.getByTitle('Resume'));
      
      expect(mockSendCommand).toHaveBeenCalledWith('cnc-main', 'resume');
    });

    it('should call sendCommand with stop when stop button clicked', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'running' })} />);
      
      fireEvent.click(screen.getByTitle('Stop'));
      
      expect(mockSendCommand).toHaveBeenCalledWith('cnc-main', 'stop');
    });

    it('should call sendCommand with reset when reset button clicked', () => {
      renderWithRouter(<DeviceCard device={createDevice({ state: 'alarm' })} />);
      
      fireEvent.click(screen.getByTitle('Reset'));
      
      expect(mockSendCommand).toHaveBeenCalledWith('cnc-main', 'reset');
    });
  });

  describe('Visual state indicators', () => {
    it('should have blue glow when running', () => {
      const { container } = renderWithRouter(
        <DeviceCard device={createDevice({ state: 'running' })} />
      );
      
      expect(container.querySelector('.glow-blue')).toBeInTheDocument();
    });

    it('should have red glow when in alarm', () => {
      const { container } = renderWithRouter(
        <DeviceCard device={createDevice({ state: 'alarm' })} />
      );
      
      expect(container.querySelector('.glow-red')).toBeInTheDocument();
    });

    it('should have amber glow when paused', () => {
      const { container } = renderWithRouter(
        <DeviceCard device={createDevice({ state: 'paused' })} />
      );
      
      expect(container.querySelector('.glow-amber')).toBeInTheDocument();
    });
  });

  describe('Device type icons', () => {
    it('should show laser icon for laser_cutter type', () => {
      const laserDevice = createDevice({ type: 'laser_cutter' });
      const { container } = renderWithRouter(<DeviceCard device={laserDevice} />);
      
      // Check for purple styling which is for laser devices
      expect(container.querySelector('.bg-purple-500\\/20')).toBeInTheDocument();
    });

    it('should show drill icon for cnc_mill type', () => {
      const cncDevice = createDevice({ type: 'cnc_mill' });
      const { container } = renderWithRouter(<DeviceCard device={cncDevice} />);
      
      // Check for blue styling which is for CNC devices
      expect(container.querySelector('.bg-blue-500\\/20')).toBeInTheDocument();
    });
  });
});
