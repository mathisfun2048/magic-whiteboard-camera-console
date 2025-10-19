"hello"
import React from 'react';

interface DeviceSelectorProps {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onChange: (deviceId: string) => void;
  disabled: boolean;
  label: string;
  otherSelectedDeviceId?: string | null;
}

const DeviceSelector: React.FC<DeviceSelectorProps> = ({ devices, selectedDeviceId, onChange, disabled, label, otherSelectedDeviceId }) => {
  return (
    <div className="flex flex-col space-y-2">
      <label htmlFor={label} className="text-sm font-medium text-gray-400">{label}</label>
      <select
        id={label}
        value={selectedDeviceId || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || devices.length === 0}
        className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <option value="" disabled>Select a camera</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId} disabled={device.deviceId === otherSelectedDeviceId}>
            {device.label || `Camera ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DeviceSelector;
