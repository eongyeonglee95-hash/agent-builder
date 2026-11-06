import React, { useEffect, useRef, useState } from 'react';
import './codex-panel.css';

const statusLabels = { queued: '대기', running: '진행 중', stopping: '중지 중', completed: '완료',
  blocked: '확인 필요', failed: '실행 오류', cancelled: '중지됨', interrupted: '중단됨' };

export default function CodexPanel({ selectedRows, onAssignmentsChange }) {
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const callbacks = useRef({ onAssignmentsChange });
  callbacks.current = { onAssignmentsChange };
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

  const action = async name => {
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/codex/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shrimp-Codex-Token': state.token },
        body: JSON.stringify({ projectId: 'retire-together', taskIds: Array.from(selectedRows) }),
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
  const jobs = (state?.jobs ?? []).slice(-8).reverse();
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
    {!!jobs.length && <div className="codex-jobs" aria-label="Codex 실행 기록">
      {jobs.map(job => <article className="codex-job" key={job.id}>
        <div><strong>{job.name}</strong><span className={`codex-job-state ${job.status}`}>{statusLabels[job.status] ?? job.status}</span></div>
        <p>{job.message}</p>
        {(job.answer || job.logs.length > 0) && <details open={['running', 'stopping'].includes(job.status) || undefined}>
          <summary>실행 내용 보기</summary>
          {job.answer && <p className="codex-answer">{job.answer}</p>}
          <pre>{job.logs.map(log => log.text).join('\n\n') || 'Codex 응답을 기다리고 있습니다…'}</pre>
        </details>}
      </article>)}
    </div>}
  </section>;
}
