'use client';
import { ErrorState } from '../components/common';
export default function Error({ reset }: { reset: () => void }) {
  return <ErrorState retry={reset} />;
}
