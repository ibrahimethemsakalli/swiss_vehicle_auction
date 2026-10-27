import { Verification } from '../../components/account-setup';
import { EmailSecurity } from '../../components/email-security';
export default function VerifyPage() {
  return (
    <>
      <div className="login-page">
        <EmailSecurity />
      </div>
      <Verification />
    </>
  );
}
