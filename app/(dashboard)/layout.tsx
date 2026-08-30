import { Sidebar } from '@/components/sidebar';import { requireUser } from '@/lib/auth/require-user';
export default async function DashboardLayout({children}:{children:React.ReactNode}){const {profile}=await requireUser();return <div className="shell"><Sidebar role={profile.role}/><main className="main">{children}</main></div>}
