import { CloudServerOutlined, BranchesOutlined, ApiOutlined, FileTextOutlined, SettingOutlined } from "@ant-design/icons";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { Navigate, type RouteObject } from "react-router";
import BasicLayout from "@/layouts/BasicLayout";
import { nestHiddenRoutes } from "./menuMatch";
import { NotFoundPage, NodesPage, RulesPage, ConnectionsPage, LogsPage, SettingsPage } from "./pages";

export interface MenuEntry { path: string; label: (t: TFunction) => string; icon?: ReactNode; hideInMenu?: boolean; children?: MenuEntry[] }
/** 客户端路由在此注册，导航和页面标题读取同一份定义。 */
export const menuRoutes: MenuEntry[] = nestHiddenRoutes([
  { path: "/nodes", label: (t: TFunction) => t("common.vocab.nodes"), icon: <CloudServerOutlined /> },
  { path: "/nodes/groups", label: (t: TFunction) => t("vpn.nodeGroups"), hideInMenu: true },
  { path: "/connections", label: (t: TFunction) => t("common.vocab.connections"), icon: <ApiOutlined /> },
  { path: "/rules", label: (t: TFunction) => t("common.vocab.rules"), icon: <BranchesOutlined /> },
  { path: "/logs", label: (t: TFunction) => t("common.vocab.logs"), icon: <FileTextOutlined /> },
  { path: "/settings", label: (t: TFunction) => t("common.vocab.settings"), icon: <SettingOutlined /> },
  { path: "/*", label: (t: TFunction) => t("app.404.title"), hideInMenu: true },
]);
export const routes: RouteObject[] = [{ path: "/", element: <BasicLayout />, children: [
  { index: true, element: <Navigate to="/nodes" replace /> },
  { path: "nodes", element: <NodesPage /> },
  { path: "nodes/groups", element: <NodesPage /> },
  { path: "rules", element: <RulesPage /> },
  { path: "apps", element: <Navigate to="/rules" replace /> },
  { path: "connections", element: <ConnectionsPage /> },
  { path: "logs", element: <LogsPage /> },
  { path: "settings", element: <SettingsPage /> },
  { path: "*", element: <NotFoundPage /> },
] }];
