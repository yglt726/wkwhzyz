import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, homeOf, useAuth } from './auth';
import { Shell } from './Shell';
import LoginPage from './pages/LoginPage';
import StudentIntentPage from './pages/StudentIntentPage';
import StudentOffersPage from './pages/StudentOffersPage';
import StudentResultPage from './pages/StudentResultPage';
import StudentProfilePage from './pages/StudentProfilePage';
import MentorApplicantsPage from './pages/MentorApplicantsPage';
import MentorOffersPage from './pages/MentorOffersPage';
import AdminQuotaPage from './pages/AdminQuotaPage';
import AdminAdjustPage from './pages/AdminAdjustPage';
import AdminAuditPage from './pages/AdminAuditPage';

function Guard({ role, children }: { role: string; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeOf(user.role)} replace />;
  return <>{children}</>;
}

function RootRedirect() {
  // 固定进入登录页：即使本地还存着上次的登录态，也不自动跳转到业务页
  return <Navigate to="/login" replace />;
}

const STUDENT_MENUS = [
  { key: '/student/intent', label: '意向填报' },
  { key: '/student/offers', label: '我的录取' },
  { key: '/student/result', label: '我的结果' },
  { key: '/student/profile', label: '个人档案' },
];

const MENTOR_MENUS = [
  { key: '/mentor/interviews', label: '面试评分' },
  { key: '/mentor/offers', label: '名额与名单' },
];

const ADMIN_MENUS = [
  { key: '/admin/quota', label: '名额总览' },
  { key: '/admin/adjust', label: '调剂与公示' },
  { key: '/admin/audit', label: '异常与审计' },
];

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RootRedirect />} />

          <Route
            path="/student"
            element={
              <Guard role="STUDENT">
                <Shell title="学生端 · 实训室进组选拔" menus={STUDENT_MENUS}>
                  <Outlet />
                </Shell>
              </Guard>
            }
          >
            <Route index element={<Navigate to="intent" replace />} />
            <Route path="intent" element={<StudentIntentPage />} />
            <Route path="offers" element={<StudentOffersPage />} />
            <Route path="result" element={<StudentResultPage />} />
            <Route path="profile" element={<StudentProfilePage />} />
          </Route>

          <Route
            path="/mentor"
            element={
              <Guard role="MENTOR">
                <Shell title="导师端 · 面试与录取" menus={MENTOR_MENUS}>
                  <Outlet />
                </Shell>
              </Guard>
            }
          >
            <Route index element={<Navigate to="interviews" replace />} />
            <Route path="interviews" element={<MentorApplicantsPage />} />
            <Route path="offers" element={<MentorOffersPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <Guard role="ADMIN">
                <Shell title="学院管理后台 · 选拔统筹" menus={ADMIN_MENUS}>
                  <Outlet />
                </Shell>
              </Guard>
            }
          >
            <Route index element={<Navigate to="quota" replace />} />
            <Route path="quota" element={<AdminQuotaPage />} />
            <Route path="adjust" element={<AdminAdjustPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
          </Route>

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
