import { isClerkEnabled } from "@/lib/auth/currentUser";

export default async function SignUpPage() {
  if (isClerkEnabled()) {
    const { SignUp } = await import("@clerk/nextjs");
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <SignUp forceRedirectUrl="/org" />
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-slate-400">
      <div>
        <p>Dev auth is active — no sign-up needed.</p>
        <a href="/org" className="text-fuchsia-400 underline">
          Go to your org
        </a>
      </div>
    </div>
  );
}
