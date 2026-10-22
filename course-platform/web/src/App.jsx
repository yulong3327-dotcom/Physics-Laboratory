import StudentApp from './student/StudentApp';
import AdminApp from './admin/AdminApp';
export default function App() { return window.location.pathname.startsWith('/admin') ? <AdminApp /> : <StudentApp />; }
