import { useState, useEffect } from 'react';
import { Card, Input, Button, Avatar, message, Tooltip, theme } from 'antd';
import { RobotOutlined, UserOutlined, SendOutlined, ArrowLeftOutlined, LikeOutlined, DislikeOutlined, LikeFilled, DislikeFilled } from '@ant-design/icons';
const { TextArea } = Input;
import type { Feedback, TaskResponse } from '../../types';
import { useFeedback } from '../../hooks/useFeedback';

interface Props {
  task: TaskResponse;
  selectedRunId?: string | null;
  feedbacks: Feedback[];
  prefill?: string;
  // optional initial edit target when opening the panel
  initialEditFeedbackId?: string;
  initialEditRating?: 'like' | 'dislike';
  onCreate: (fb: Feedback) => void;
  onDelete?: (id: string) => void;
  onClose?: () => void;
}

export default function ExecutionFeedback({ task, selectedRunId, feedbacks, prefill, initialEditFeedbackId, initialEditRating, onCreate, onDelete, onClose }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState<'like' | 'dislike' | undefined>(initialEditRating);
  const [editingFeedback, setEditingFeedback] = useState<Feedback | null>(null);
  const [editText, setEditText] = useState('');
  const [editRating, setEditRating] = useState<'like' | 'dislike' | undefined>(undefined);

  const { token } = theme.useToken();

  const { createFeedback, updateFeedback, deleteFeedback } = useFeedback();

  useEffect(() => {
    if (typeof prefill !== 'undefined') {
      setText(prefill || '');
    }
  }, [prefill]);

  // don't auto-open edit for existing feedback; editing is triggered by Edit button
  useEffect(() => {
    // if an edited feedback was removed externally, clear editing state
    if (editingFeedback && !feedbacks.find(f => f.id === editingFeedback.id)) {
      setEditingFeedback(null);
      setEditText('');
      setEditRating(undefined);
    }
  }, [feedbacks, editingFeedback]);

  // If parent requested opening the panel in edit mode for a specific feedback id, do it
  useEffect(() => {
    if (initialEditFeedbackId) {
      const fb = feedbacks.find(f => f.id === initialEditFeedbackId);
      if (fb) {
        startInlineEdit(fb);
        if (initialEditRating) setEditRating(initialEditRating);
      }
    }
  }, [initialEditFeedbackId, initialEditRating]);

  const submit = async () => {
    const content = text.trim();
    if (!content) return message.warning('Please enter feedback');

    try {
      setSending(true);
      if (editingFeedback) {
        // call update endpoint
        const updated = await updateFeedback(editingFeedback.id, { content, rating });
        onCreate(updated);
        setEditingFeedback(null);
      } else {
        // if there's already a feedback for this run, prevent creating another
        if (selectedRunId) {
          const existing = feedbacks.find(f => f.taskRunId === selectedRunId);
          if (existing) {
            message.warning('Feedback already exists for this run. Edit the existing feedback instead.');
            return;
          }
        }

        const created = await createFeedback({ taskId: task.id, taskRunId: selectedRunId || undefined, content, rating });
        onCreate(created);
      }

      setText('');
      setRating(undefined);
      message.success('Feedback submitted');
      onClose?.();
    } catch (err) {
      console.error('Failed to submit feedback', err);
      message.error('Failed to submit feedback');
    } finally {
      setSending(false);
    }
  };

  const startInlineEdit = (fb: Feedback) => {
    setEditingFeedback(fb);
    setEditText(fb.content);
    setEditRating(fb.rating as any);
  };

  const cancelInlineEdit = () => {
    setEditingFeedback(null);
    setEditText('');
    setEditRating(undefined);
  };

  const saveInlineEdit = async () => {
    if (!editingFeedback) return;
    const content = editText.trim();
    if (!content) return message.warning('Please enter feedback');
    try {
      setSending(true);
      const updated = await updateFeedback(editingFeedback.id, { content, rating: editRating });
      onCreate(updated);
      message.success('Feedback updated');
      setEditingFeedback(null);
      setEditText('');
      setEditRating(undefined);
    } catch (err) {
      console.error('Failed to update feedback', err);
      message.error('Failed to update feedback');
    } finally {
      setSending(false);
    }
  };

  const deleteInline = async (fb: Feedback) => {
    try {
      setSending(true);
      await deleteFeedback(fb.id);
      onDelete?.(fb.id);
      message.success('Feedback deleted');
      if (editingFeedback?.id === fb.id) cancelInlineEdit();
    } catch (err) {
      console.error('Failed to delete feedback', err);
      message.error('Failed to delete feedback');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      title="Feedback"
      extra={(
        <Button type="text" size="small" onClick={() => onClose?.()} icon={<ArrowLeftOutlined />}>
          Back
        </Button>
      )}
      style={{
        width: 550,
        margin: '0px 24px 20px 0',
        transition: 'width 200ms ease, margin 200ms ease',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 166px)',
        background: token.colorBgContainer,
        boxShadow: token.boxShadow,
      }}
      bodyStyle={{ flex: 1, overflow: 'auto', padding: '8px 0' }}
      headStyle={{ borderBottom: `1px solid ${token.colorBorder}`, padding: '12px 16px' }}
    >
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, height: '100%', boxSizing: 'border-box' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {feedbacks.length === 0 ? (
            <div style={{ color: token.colorTextSecondary, textAlign: 'center', padding: '16px 0' }}>No feedback yet</div>
          ) : (
            feedbacks.map((fb) => (
              <div key={fb.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Avatar
                  size={28}
                  icon={fb.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                  style={{
                    backgroundColor: fb.role === 'user' ? token.colorPrimary : token.colorSuccess,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{fb.role === 'user' ? 'You' : 'System'}</div>
                    <div style={{ color: token.colorTextSecondary, fontSize: 11 }}>{new Date(fb.createdAt).toLocaleTimeString()}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      {/* Always present thumbs for user feedback; clicking toggles rating immediately */}
                      {fb.role === 'user' && (
                        <>
                          <Tooltip title="Thumbs up">
                            <Button
                              size="small"
                              type="text"
                              onClick={(e) => { e.stopPropagation();
                                // Always open inline edit and set the edit rating to the clicked value.
                                startInlineEdit(fb);
                                setEditRating('like');
                              }}
                              icon={editingFeedback?.id === fb.id ? (editRating === 'like' ? <LikeFilled style={{ color: token.colorText }} /> : <LikeOutlined style={{ color: token.colorText }} />) : (fb.rating === 'like' ? <LikeFilled style={{ color: token.colorText }} /> : <LikeOutlined style={{ color: token.colorText }} />)}
                            />
                          </Tooltip>
                          <Tooltip title="Thumbs down">
                            <Button
                              size="small"
                              type="text"
                              onClick={(e) => { e.stopPropagation();
                                startInlineEdit(fb);
                                setEditRating('dislike');
                              }}
                              icon={editingFeedback?.id === fb.id ? (editRating === 'dislike' ? <DislikeFilled style={{ color: token.colorText }} /> : <DislikeOutlined style={{ color: token.colorText }} />) : (fb.rating === 'dislike' ? <DislikeFilled style={{ color: token.colorText }} /> : <DislikeOutlined style={{ color: token.colorText }} />)}
                            />
                          </Tooltip>
                        </>
                      )}
                      {fb.role === 'user' && fb.taskRunId && fb.taskRunId === selectedRunId && !editingFeedback && (
                        <Button type="link" onClick={() => startInlineEdit(fb)} style={{ marginLeft: 0 }}>Edit</Button>
                      )}
                    </div>
                  </div>

                  {editingFeedback?.id === fb.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <TextArea value={editText} onChange={(e) => setEditText(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, color: token.colorText, borderRadius: 8, padding: '8px' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                          <Button onClick={cancelInlineEdit}>Cancel</Button>
                          <Button danger onClick={() => deleteInline(fb)} loading={sending}>Delete</Button>
                          <Button type="primary" onClick={saveInlineEdit} loading={sending}>Save</Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: fb.role === 'user' ? token.colorBgElevated : token.colorBgContainer,
                        padding: '10px 12px',
                        borderRadius: 8,
                        fontSize: 13,
                        lineHeight: '1.6',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        border: fb.role === 'user' ? `1px solid ${token.colorBorder}` : `1px solid ${token.colorSuccess}`,
                      }}
                    >
                      {fb.content}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* If a feedback already exists for this run, hide the global compose area and only allow inline editing */}
        {(!selectedRunId || !feedbacks.find(f => f.taskRunId === selectedRunId)) ? (
          <div style={{ borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TextArea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tell the agent what to do differently next time..."
                autoSize={{ minRows: 1, maxRows: 5 }}
                style={{ fontSize: 14, resize: 'none', borderRadius: 8, background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, color: token.colorText, padding: '8px 10px', minHeight: 40 }}
                disabled={sending}
              />
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={submit}
                  disabled={!text.trim() || sending}
                  loading={sending}
                  style={{ height: 40, width: 40, padding: 0, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12 }}>
            <div style={{ padding: '8px 12px', color: token.colorTextSecondary, fontSize: 13 }}>
              A feedback already exists for this run — edit it inline above.
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
