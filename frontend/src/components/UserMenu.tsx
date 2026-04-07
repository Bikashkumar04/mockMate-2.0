"use client";

import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface UserMenuProps {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export default function UserMenu({ name, email, image }: UserMenuProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const initials = name
    ? name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
    : (email?.[0]?.toUpperCase() ?? "U");

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace("/login");
      router.refresh();
    } catch {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 hover:border-orange/50 transition-colors outline-none border-border bg-background"
          aria-label="User menu"
        >
          <Avatar className="w-7 h-7">
            <AvatarImage src={image ?? undefined} alt={name ?? "User"} />
            <AvatarFallback className="bg-orange/10 text-orange text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            className="text-muted-foreground"
            aria-hidden="true"
          >
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-52 rounded-xl">
        {/* User info */}
        <DropdownMenuLabel className="flex items-center gap-3 px-3 py-3">
          <Avatar className="w-9 h-9 shrink-0">
            <AvatarImage src={image ?? undefined} alt={name ?? "User"} />
            <AvatarFallback className="bg-orange/10 text-orange text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            {name && <p className="text-sm font-medium truncate">{name}</p>}
            {email && <p className="text-xs text-muted-foreground truncate font-normal">{email}</p>}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer">
            {theme === "dark" ? <Moon size={14} /> : theme === "light" ? <Sun size={14} /> : <Monitor size={14} />}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-xl">
            <DropdownMenuItem
              onSelect={() => setTheme("light")}
              className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer"
            >
              <Sun size={14} />
              Light
              {theme === "light" && <span className="ml-auto text-orange text-xs">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setTheme("dark")}
              className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer"
            >
              <Moon size={14} />
              Dark
              {theme === "dark" && <span className="ml-auto text-orange text-xs">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setTheme("system")}
              className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer"
            >
              <Monitor size={14} />
              System
              {theme === "system" && <span className="ml-auto text-orange text-xs">✓</span>}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          onSelect={handleSignOut}
          className="flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer"
        >
          <LogOut size={14} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

