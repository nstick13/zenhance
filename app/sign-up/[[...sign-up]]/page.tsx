import { isClerkEnabled } from "@/lib/auth/currentUser";

export default async function SignUpPage() {
  if (isClerkEnabled()) {
    const { SignUp } = await import("@clerk/nextjs");
    return (
      <div className="flex flex-1 items-center justify-center bg-paper p-6">
        <SignUp forceRedirectUrl="/org" />
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center bg-paper p-6 text-center text-ink-soft">
      <div>
        <p>Dev auth is active — no sign-up needed.</p>
        <a href="/org" className="text-grow underline">
          Go to your org
        </a>
      </div>
    </div>
  );
}
