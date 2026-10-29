export function hasSupportDraft(subject: string, body: string, reason: string) {
  return Boolean(subject.length || body.length || reason.length);
}

// This event carries no draft content. Cancel it before an imperative sign-out.
export const SUPPORT_LEAVE_EVENT = 'support-request-leave';
export function requestSupportLeave(action: () => void) {
  if (
    window.dispatchEvent(new CustomEvent(SUPPORT_LEAVE_EVENT, { cancelable: true, detail: action }))
  )
    action();
}

export function installSupportDraftGuard(
  target: Window,
  dirty: () => boolean,
  prompt: (proceed: () => void) => void,
) {
  let approved = false;
  const allow = (action: () => void) => {
    if (!dirty() || approved) {
      action();
      return true;
    }
    prompt(() => {
      approved = true;
      action();
    });
    return false;
  };
  const edited = () => {
    approved = false;
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (!dirty() || approved) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const leave = (event: Event) => {
    if (!dirty() || approved) return;
    event.preventDefault();
    const action = (event as CustomEvent<() => void>).detail;
    if (typeof action === 'function') allow(action);
  };
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self'))
      return;
    const url = new URL(anchor.href, target.location.href);
    if (
      url.origin === target.location.origin &&
      url.pathname === target.location.pathname &&
      url.search === target.location.search
    )
      return;
    if (dirty() && !approved) {
      event.preventDefault();
      event.stopImmediatePropagation();
      allow(() => anchor.click());
    }
  };
  // Navigation API can cancel same-document Back/Forward before React unmounts.
  const navigation = (
    target as Window & { navigation?: EventTarget & { traverseTo(key: string): unknown } }
  ).navigation;
  const traverse = (event: Event) => {
    const e = event as Event & {
      navigationType?: string;
      destination?: { sameDocument?: boolean; key?: string };
    };
    if (
      e.navigationType === 'traverse' &&
      e.destination?.sameDocument &&
      e.cancelable &&
      dirty() &&
      !approved
    ) {
      e.preventDefault();
      const key = e.destination.key;
      if (key) allow(() => navigation?.traverseTo(key));
    }
  };
  target.document.addEventListener('input', edited, true);
  target.addEventListener('beforeunload', unload);
  target.addEventListener(SUPPORT_LEAVE_EVENT, leave);
  target.document.addEventListener('click', click, true);
  navigation?.addEventListener('navigate', traverse);
  return {
    allow,
    dispose: () => {
      target.document.removeEventListener('input', edited, true);
      target.removeEventListener('beforeunload', unload);
      target.removeEventListener(SUPPORT_LEAVE_EVENT, leave);
      target.document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', traverse);
    },
  };
}
