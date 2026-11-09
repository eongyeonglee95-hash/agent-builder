import React, { useEffect, useRef, useState } from 'react';
import './codex-panel.css';

const statusLabels = { queued: '대기', running: '진행 중', stopping: '중지 중', completed: '완료',
  blocked: '확인 필요', failed: '실행 오류', cancelled: '중지됨', interrupted: '중단됨' };
const taskLabels = { pending: '대기', in_progress: '진행 중', completed: '완료', awaiting_confirmation: '확인 대기', retry_required: '재실행 필요' };
const isLive = job => ['queued', 'running', 'stopping'].includes(job.status);
const executionTime = value => value && !Number.isNaN(Date.parse(value))
  ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '시각 미기록';

export default function CodexPanel({ selectedRows, onAssignmentsChange, onTaskStatusesChange }) {
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const callbacks = useRef({ onAssignmentsChange, onTaskStatusesChange });
  callbacks.current = { onAssignmentsChange, onTaskStatusesChange };
  const refresh = useRef(null);

  useEffect(() => {
    let mounted = true, timer;
    const load = async () => {
      try {
        const response = await fetch('/api/codex/status', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '연결 상태를 확인하지 못했습니다.');
        if (!mounted) return;
        setState(result);
        callbacks.current.onAssignmentsChange(result.assignments);
        callbacks.current.onTaskStatusesChange?.(result.taskDisplayStatuses ?? {});
        // Let the upstream table's existing refresh update task data. Its save callback
        // unmounts this panel and clears the user's selection, so do not call it here.
      } catch (err) {
        if (mounted) { setError(`쉬림프 연결을 확인해 주세요. ${err.message}`); setState(null); }
      }
    };
    refresh.current = load;
    const poll = async () => { await load(); if (mounted) timer = setTimeout(poll, 2000); };
    poll();
    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  const action = async (name, extra = {}) => {
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/codex/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shrimp-Codex-Token': state.token },
        body: JSON.stringify({ projectId: 'retire-together', taskIds: Array.from(selectedRows), ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
      setNotice(result.message);
      await refresh.current?.();
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  };

  const disabled = pending || !state || state.busy || state.orphan;
  const selected = selectedRows.size;
  const jobs = [...(state?.jobs ?? [])].reverse();
  const activeJobs = jobs.filter(job => !job.acknowledgedAt || isLive(job));
  const archivedJobs = jobs.filter(job => job.acknowledgedAt && !isLive(job));
  // The latest attempt owns the next action, even when its notification was archived.
  const latestJobs = [...new Map([...(state?.jobs ?? [])].filter(job => job.taskId).map(job => [job.taskId, job])).values()];
  const retryJobs = latestJobs.filter(job => !isLive(job) && job.currentTask?.displayStatus === 'retry_required');
  const renderJob = job => {
    const live = isLive(job);
    const current = job.currentTask;
    const displayStatus = current?.displayStatus ?? current?.status;
    const resolved = !live && current?.status === 'completed';
    const waiting = !live && displayStatus === 'awaiting_confirmation';
    const label = !live && current ? `현재 작업: ${taskLabels[displayStatus] ?? displayStatus}` : `실행: ${statusLabels[job.status] ?? job.status}`;
    return <article className="codex-job" key={job.id}>
      <div><strong>{job.name}</strong><span className={`codex-job-state ${resolved ? 'completed' : !live && current ? displayStatus : job.status}`}>{label}</span></div>
      <p className="codex-job-meta">실행 시각: {executionTime(job.createdAt)} · {live ? '실행 상태' : '당시 결과'}: {statusLabels[job.status] ?? job.status}</p>
      <p>{resolved && job.status !== 'completed' ? '이 작업은 이후 완료되었습니다. 아래는 당시의 실행 기록이며, 다시 실행할 필요가 없습니다.' : job.message}</p>
      {waiting && <p className="codex-waiting-note">실행이 끝났지만 완료 검증이 남았습니다. 실행 내용에서 필요한 조치를 확인해 주세요. 알림을 접어도 작업은 완료되지 않습니다.</p>}
      {resolved && current.summary && <details className="codex-verification"><summary>현재 완료 근거 보기</summary><p className="codex-answer">{current.summary}</p></details>}
      {(job.answer || job.logs.length > 0) && <details open={live || undefined}>
        <summary>{live ? '실행 내용 보기' : '당시 실행 내용 보기'}</summary>
        {job.answer && <p className="codex-answer">{job.answer}</p>}
        <pre>{job.logs.map(log => log.text).join('\n\n') || 'Codex 응답을 기다리고 있습니다…'}</pre>
      </details>}
      {!live && !job.acknowledgedAt && <button type="button" className="codex-acknowledge" disabled={disabled} onClick={() => action('acknowledge', { jobId: job.id })}>알림 접기</button>}
      {job.acknowledgedAt && <small>알림 확인: {executionTime(job.acknowledgedAt)} · 작업 상태는 유지됩니다.</small>}
    </article>;
  };
  return <section className="codex-panel" aria-label="Codex 구독 실행">
    <div className="codex-panel-heading">
      <div><strong>Codex로 작업하기</strong><span className={`codex-connection ${state?.auth.connected ? 'connected' : ''}`}>
        {state?.auth.message ?? '연결 확인 중…'}
      </span></div>
      <button type="button" disabled={disabled || !state?.auth.connected} onClick={() => action('check')}>연결 테스트</button>
    </div>
    <p>작업을 체크하고 실행하세요. 선택한 작업을 선행 순서에 따라 하나씩 진행합니다. 실행에는 구독 사용량이 적용됩니다.</p>
    <div className="codex-panel-actions">
      <span>{selected ? `${selected}개 선택` : '아래 목록에서 작업을 선택하세요'}</span>
      <button type="button" disabled={disabled || !selected} onClick={() => action('assign')}>Codex에 배정</button>
      <button type="button" className="codex-run" disabled={disabled || !selected || !state?.auth.connected} onClick={() => action('run')}>선택 작업 실행</button>
      {state?.busy && <button type="button" className="codex-stop" disabled={pending} onClick={() => action('stop')}>실행 중지</button>}
    </div>
    <small>배정만 하면 실행되지 않습니다. 실행 중에는 이 작업들을 다른 Codex 대화에서 동시에 진행하지 마세요.</small>
    {state?.orphan && <p role="alert" className="codex-error">이전 Codex 프로세스가 남아 있습니다. 종료 여부를 확인한 뒤 뷰어를 다시 시작해 주세요.</p>}
    {notice && <p role="status" className="codex-notice">{notice}</p>}
    {error && <p role="alert" className="codex-error">{error}</p>}
    {state?.taskStateError && <p role="alert" className="codex-error">{state.taskStateError}</p>}
    {!!retryJobs.length && <section className="codex-retry" aria-label="재실행이 필요한 작업">
      {retryJobs.map(job => <article key={job.taskId}>
        <strong>{job.name}</strong>
        <p>현재 실행은 중단됐습니다. {job.message}</p>
        <p>기존 변경 내용을 확인하며 이 작업만 다시 실행합니다. 자동으로 시작하지 않으며, 실행에는 구독 사용량이 적용됩니다.</p>
        <button type="button" className="codex-run" disabled={disabled || !state?.auth.connected} onClick={() => action('run', { taskIds: [job.taskId] })}>이 작업 다시 실행</button>
      </article>)}
    </section>}
    {!!jobs.length && <><p className="codex-history-help">현재 작업 상태와 실행 당시 결과를 함께 표시합니다. ‘알림 접기’는 기록을 접으며 완료 처리나 재실행을 하지 않습니다.</p>
      <div className="codex-jobs" aria-label="확인할 실행 기록">{activeJobs.map(renderJob)}</div>
      {!!archivedJobs.length && <details className="codex-archive"><summary>확인한 실행 기록 ({archivedJobs.length}건)</summary>{archivedJobs.map(renderJob)}</details>}
    </>}
  </section>;
}
