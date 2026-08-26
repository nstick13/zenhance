import { isClerkEnabled } from "@/lib/auth/currentUser";

export default async function SignInPage() {
  if (isClerkEnabled()) {
    const { SignIn } = await import("@clerk/nextjs");
    return (
      <div className="flex flex-1 items-center justify-center bg-paper p-6">
        <SignIn forceRedirectUrl="/org" />
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center bg-paper p-6 text-center text-ink-soft">
      <div>
        <p>Dev auth is active — you are already signed in.</p>
        <a href="/org" className="text-grow underline">
          Go to your org
        </a>
      </div>
    </div>
  );
}
