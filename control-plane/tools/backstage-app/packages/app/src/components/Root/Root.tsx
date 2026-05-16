import { PropsWithChildren } from 'react';
import { makeStyles } from '@material-ui/core';
import HomeIcon from '@material-ui/icons/Home';
import ExtensionIcon from '@material-ui/icons/Extension';
import CreateComponentIcon from '@material-ui/icons/AddCircleOutline';
import LogoFull from './LogoFull';
import LogoIcon from './LogoIcon';
import {
  Settings as SidebarSettings,
  UserSettingsSignInAvatar,
} from '@backstage/plugin-user-settings';
import { SidebarSearchModal } from '@backstage/plugin-search';
import {
  Sidebar,
  sidebarConfig,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarPage,
  SidebarScrollWrapper,
  SidebarSpace,
  useSidebarOpenState,
  Link,
} from '@backstage/core-components';
import MenuIcon from '@material-ui/icons/Menu';
import SearchIcon from '@material-ui/icons/Search';
import { NotificationsSidebarItem } from '@backstage/plugin-notifications';
import { useRoleAccess } from '../../hooks/useRoleAccess';
import { authzConfig } from '../../generated/authzConfig';

const useSidebarLogoStyles = makeStyles({
  root: {
    width: sidebarConfig.drawerWidthClosed,
    height: 3 * sidebarConfig.logoHeight,
    display: 'flex',
    flexFlow: 'row nowrap',
    alignItems: 'center',
    marginBottom: -14,
  },
  link: {
    width: sidebarConfig.drawerWidthClosed,
    marginLeft: 24,
  },
});

const SidebarLogo = () => {
  const classes = useSidebarLogoStyles();
  const { isOpen } = useSidebarOpenState();

  return (
    <div className={classes.root}>
      <Link to="/" underline="none" className={classes.link} aria-label="Home">
        {isOpen ? <LogoFull /> : <LogoIcon />}
      </Link>
    </div>
  );
};

const AgenciesAdminCreateSidebarItem = () => {
  const { loading, isAgenciesAdmin } = useRoleAccess();

  if (loading || !isAgenciesAdmin) {
    return null;
  }

  return (
    <SidebarItem icon={CreateComponentIcon} to="create" text="Create Agency XRD" />
  );
};

export const Root = ({ children }: PropsWithChildren<{}>) => (
  <RoleScopedRoot>{children}</RoleScopedRoot>
);

const RoleScopedRoot = ({ children }: PropsWithChildren<{}>) => {
  const { loading, isAgenciesAdmin, isArgocdAdmin, isOpenbaoAdmin } = useRoleAccess();
  const argocdMenuItems = isArgocdAdmin
    ? authzConfig.menu.argocdAdmin
    : isAgenciesAdmin
      ? authzConfig.menu.agenciesAdmin
      : [];

  return (
    <SidebarPage>
      <Sidebar>
        <SidebarLogo />
        <SidebarGroup label="Search" icon={<SearchIcon />} to="/search">
          <SidebarSearchModal />
        </SidebarGroup>
        <SidebarDivider />
        <SidebarGroup label="Menu" icon={<MenuIcon />}>
          <SidebarItem icon={HomeIcon} to="catalog" text="Home" />
          {loading
            ? null
            : argocdMenuItems.map(item => (
                <SidebarItem key={item.to} icon={ExtensionIcon} to={item.to} text={item.text} />
              ))}
          {loading || !isOpenbaoAdmin ? null : (
            <SidebarItem
              icon={ExtensionIcon}
              to="catalog/default/resource/openbao-secrets"
              text="OpenBao"
            />
          )}
          {loading || !isAgenciesAdmin ? null : (
            <>
              <AgenciesAdminCreateSidebarItem />
            </>
          )}
          <SidebarDivider />
          <SidebarScrollWrapper />
        </SidebarGroup>
        <SidebarSpace />
        <SidebarDivider />
        <NotificationsSidebarItem />
        <SidebarDivider />
        <SidebarGroup
          label="Settings"
          icon={<UserSettingsSignInAvatar />}
          to="/settings"
        >
          <SidebarSettings />
        </SidebarGroup>
      </Sidebar>
      {children}
    </SidebarPage>
  );
};
