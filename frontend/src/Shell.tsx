import { Avatar, Dropdown, Layout, Menu, Space, Tag, Typography } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { homeOf, useAuth } from './auth';

const { Header, Sider, Content } = Layout;

const ROLE_LABEL: Record<string, string> = {
  STUDENT: '学生端',
  MENTOR: '导师端',
  ADMIN: '学院管理后台',
};

export function Shell({
  menus,
  children,
  title,
}: {
  menus: { key: string; label: string }[];
  children: React.ReactNode;
  title: string;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth={0} width={216} className="app-sider">
        <div className="app-brand">
          <span className="app-brand-mark">选</span>
          <div>
            <div className="app-brand-title">实训室进组</div>
            <div className="app-brand-sub">双向选择 · 分轮录取</div>
          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menus.map((m) => ({ key: m.key, label: m.label }))}
          onClick={(e) => navigate(e.key)}
        />
        <div className="app-sider-footer">v1.0 · 本地演练环境</div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <div>
            <Typography.Text strong style={{ fontSize: 17 }}>
              {title}
            </Typography.Text>
          </div>
          <Space size={12}>
            <Tag color={user?.role === 'ADMIN' ? 'gold' : user?.role === 'MENTOR' ? 'blue' : 'green'}>
              {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
            </Tag>
            <Dropdown
              menu={{
                items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录' }],
                onClick: () => {
                  logout();
                  navigate('/login');
                },
              }}
            >
              <Space className="app-user" onClick={() => undefined}>
                <Avatar size={30} icon={<UserOutlined />} />
                <span>{user?.name}</span>
                {user?.labName ? <Typography.Text type="secondary">{user.labName}</Typography.Text> : null}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}

export function homeForRole(role?: string) {
  return homeOf(role);
}
