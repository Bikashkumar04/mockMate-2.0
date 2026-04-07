import Link from "next/link";
import Logo from "@/components/Logo";
import UserMenu from "@/components/UserMenu";

type AppHeaderProps = {
  homeHref?: string;
  sticky?: boolean;
  showUserMenu?: boolean;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export default function AppHeader({
  homeHref = "/dashboard",
  sticky = true,
  showUserMenu = true,
  name,
  email,
  image,
}: AppHeaderProps) {
  return (
    <header
      className={`${sticky ? "sticky top-0 z-30" : ""} bg-background border-border border-b h-16 px-4 sm:px-6 flex items-center justify-between shrink-0`}
    >
      <Link href={homeHref} className="flex items-center gap-2.5">
        <Logo className="text-foreground" />
        <span className="text-foreground font-semibold text-lg tracking-tight">
          Mock<span className="text-orange">Mate</span>
        </span>
      </Link>
      {showUserMenu ? (
        <UserMenu name={name} email={email} image={image} />
      ) : (
        <div aria-hidden className="w-8" />
      )}
    </header>
  );
}
