import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Space,
  Typography,
  Upload,
} from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { api, errMsg, formatTime } from '../api';

const RESUME_LIMIT = 5 * 1024 * 1024;

export default function StudentProfilePage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/student/profile');
      setData(res.data);
      form.setFieldsValue({
        phone: res.data?.profile?.phone ?? '',
        email: res.data?.profile?.email ?? '',
        intro: res.data?.profile?.intro ?? '',
      });
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const res = await api.put('/student/profile', values);
      setData(res.data);
      message.success('个人档案已保存');
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const uploadResume = async (options: any) => {
    const file = options?.file as File | undefined;
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      const res = await api.post('/student/profile/resume', fd);
      setData(res.data);
      options?.onSuccess?.(res.data);
      message.success('简历上传成功');
    } catch (e: any) {
      options?.onError?.(e);
      if (e?.response?.status === 413) {
        message.error('简历文件不能超过 5MB，请压缩后重新上传');
      } else {
        message.error(errMsg(e));
      }
    } finally {
      setUploading(false);
    }
  };

  const beforeUpload = (file: File) => {
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      message.error('文件类型不支持，仅可上传 PDF、DOC、DOCX 格式');
      return Upload.LIST_IGNORE;
    }
    if (file.size > RESUME_LIMIT) {
      message.error(`文件大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超出限制，简历不能超过 5MB`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const uploadHint = (
    <Typography.Text type="secondary">支持 PDF / DOC / DOCX 格式，单个文件不超过 5MB。</Typography.Text>
  );

  const downloadResume = async () => {
    try {
      const res = await api.get('/student/profile/resume', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = data?.profile?.resume?.name || '简历';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const profile = data?.profile;
  const resume = profile?.resume;

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            个人档案
          </Typography.Title>
          <Typography.Text type="secondary">
            导师面试前会查看你的档案与简历，请保证联系方式与个人简介真实有效。
          </Typography.Text>
        </div>
      </div>

      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="专业、班级、绩点与排名由教务统一维护"
        description="如需更正学籍信息，请联系学院管理员；手机、邮箱与个人简介可自行修改。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card size="small" title="学籍信息" loading={loading}>
            <Descriptions
              column={1}
              size="small"
              bordered
              items={[
                { key: 'name', label: '姓名', children: data?.student?.name ?? '-' },
                { key: 'studentNo', label: '学号', children: data?.student?.studentNo || '-' },
                { key: 'major', label: '专业', children: profile?.major || '-' },
                { key: 'className', label: '班级', children: profile?.className || '-' },
                { key: 'gpa', label: '绩点', children: profile?.gpa ?? '-' },
                {
                  key: 'rank',
                  label: '专业排名',
                  children:
                    profile?.rankNo && profile?.rankTotal ? `${profile.rankNo}/${profile.rankTotal}` : '-',
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="联系方式与个人简介"
            extra={
              <Button type="primary" size="small" loading={saving} onClick={() => void save()}>
                保存修改
              </Button>
            }
            loading={loading}
          >
            <Form form={form} layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="手机号"
                    name="phone"
                    rules={[{ pattern: /^$|^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号' }]}
                  >
                    <Input placeholder="如 13800000001" maxLength={11} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="邮箱"
                    name="email"
                    rules={[{ type: 'email', message: '请输入正确的邮箱地址' }]}
                  >
                    <Input placeholder="如 student01@campus.edu.cn" maxLength={100} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="个人简介" name="intro" rules={[{ max: 1000, message: '个人简介不能超过 1000 字' }]}>
                <Input.TextArea
                  rows={6}
                  maxLength={1000}
                  showCount
                  placeholder="介绍你的技术方向、项目经历、时间投入与期望，便于导师了解你"
                />
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="个人简历" style={{ marginTop: 16 }} loading={loading}>
        {resume ? (
          <Space direction="vertical" size={8}>
            <Space wrap>
              <Typography.Text strong>{resume.name}</Typography.Text>
              <Typography.Text type="secondary">
                {resume.size ? `${Math.round(resume.size / 1024)} KB` : '-'}
                {resume.uploadedAt ? ` · 上传于 ${formatTime(resume.uploadedAt)}` : ''}
              </Typography.Text>
            </Space>
            <Space>
              <Button icon={<DownloadOutlined />} onClick={() => void downloadResume()}>
                查看 / 下载简历
              </Button>
              <Upload
                accept=".pdf,.doc,.docx"
                maxCount={1}
                showUploadList={false}
                beforeUpload={beforeUpload}
                customRequest={(options) => {
                  void uploadResume(options);
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploading}>
                  更换简历
                </Button>
              </Upload>
            </Space>
            {uploadHint}
            <Typography.Text type="secondary">重新上传会覆盖原简历文件。</Typography.Text>
          </Space>
        ) : (
          <Space direction="vertical" size={8}>
            <Typography.Text type="secondary">尚未上传简历，导师只能查看到你的档案信息。</Typography.Text>
            <Upload
              accept=".pdf,.doc,.docx"
              maxCount={1}
              showUploadList={false}
              beforeUpload={beforeUpload}
              customRequest={(options) => {
                void uploadResume(options);
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传简历
              </Button>
            </Upload>
            {uploadHint}
          </Space>
        )}
      </Card>
    </div>
  );
}
