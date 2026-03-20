import { Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import MainLayout from './components/layout/MainLayout'
import Dashboard from './pages/Dashboard'
import DeviceDetail from './pages/DeviceDetail'
import JobManager from './pages/JobManager'
import Automation from './pages/Automation'
import Settings from './pages/Settings'
import { useDeviceStore } from './stores/deviceStore'
import NotificationOverlay from './components/common/NotificationOverlay'

function App() {
  const { connect, disconnect } = useDeviceStore()
  
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])
  
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/device/:deviceId" element={<DeviceDetail />} />
        <Route path="/jobs" element={<JobManager />} />
        <Route path="/automation" element={<Automation />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <NotificationOverlay />
    </MainLayout>
  )
}

export default App
