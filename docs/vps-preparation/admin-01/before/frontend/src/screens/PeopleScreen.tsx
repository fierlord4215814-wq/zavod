import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { ActionModal, ActionModalField } from '../components/ActionModal';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { PremiumKpiStrip, PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { PeopleSearchPanel } from '../components/PeopleSearchPanel';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { displayLabel, employeeStateLabels, roleLabel } from '../labels';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { appStore, useAppStore } from '../store/app.store';
import type { Attachment, Line } from '../store/app.store';
import { compactDistinctLabels, isAssignableRole, shortPersonName } from '../utils/pilot-ui';

type PersonRow = {
  userId: string;
  displayName: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  employeeState: string;
  phoneLabel: string;
  profilePhoto?: Attachment | null;
  skillsSummary: string;
  onShift?: boolean;
  serviceTaskStatus?: { state: 'FREE' | 'ON_TASK'; label: string; taskId?: string; title?: string | null; lineName?: string | null; departments?: string[]; sourceRoute?: string } | null;
};

type Skill = {
  id: string;
  lineId: string;
  lineName: string | null;
  positionId: string;
  positionName: string | null;
  experienceCount: number;
  level: string;
  color: string;
  recommended: boolean;
  recommendationComment?: string | null;
};

type Profile = PersonRow & {
  id: string;
  phone?: string | null;
  skills: Skill[];
  notes: Array<{ id: string; text: string; visibility: string; authorId: string; createdAt: string }>;
  factoryAccesses: Array<{ factoryName: string; role: string; departmentName: string | null; isActive: boolean }>;
  availableActions: string[];
  currentAssignment?: {
    kind?: string | null;
    lineName?: string | null;
    positionName?: string | null;
    staffingTemplateName?: string | null;
    timeRoleName?: string | null;
    workAreaName?: string | null;
    workAreaPositionName?: string | null;
    slotIndex?: number | null;
    washSessionId?: string | null;
    startedAt?: string | null;
  } | null;
};

type PasswordResetCapability = {
  allowed: boolean;
  reason: string | null;
  passwordResetRequired: boolean;
  recoveryActive: boolean;
  recoveryExpiresAt: string | null;
};

type PasswordRecoveryResult = {
  passwordResetRequired: true;
  recoveryCredential: string;
  recoveryExpiresAt: string;
  replacedExisting: boolean;
};

type PeopleResponse = { people: PersonRow[]; groups: Record<string, PersonRow[]> };
type TimeArea = {
  id: string;
  name: string;
  assignmentKind: 'TIME' | 'WORK_AREA';
  shortageSummary?: Array<{ workAreaPositionId: string; title: string; actual: number; plannedCount: number }>;
};
type ShiftFilter = 'all' | 'shift' | 'offShift';
type CategoryFilter = 'all' | 'workers' | 'contractors' | 'management' | 'services';
type Modal = 'skill' | 'edit-skill' | 'note' | 'edit-note' | 'delete-note' | 'password-reset' | 'password-recovery-issued' | null;

const roleFilters: Record<CategoryFilter, string[]> = {
  all: [],
  workers: ['WORKER'],
  contractors: ['CONTRACTOR', 'CONTRACTOR_LEAD'],
  management: ['ADMIN', 'MANAGEMENT', 'MASTER'],
  services: ['OKK', 'STORE', 'TECHNOLOG', 'TECH_HOLOD', 'TECH_KIPIA', 'TECH_ELECTRIC', 'TECH_MECHANIC', 'TECH_SANTECHNIK'],
};

const shiftFilters: Array<[ShiftFilter, string]> = [
  ['all', 'Все'],
  ['shift', 'На смене'],
  ['offShift', 'Вне смены'],
];

const categoryFilters: Array<[CategoryFilter, string]> = [
  ['all', 'Все роли'],
  ['workers', 'Работники'],
  ['contractors', 'Наёмные'],
  ['management', 'Руководство'],
  ['services', 'Службы'],
];

export type PeopleTaskReturn = { profileId: string; shiftFilter: ShiftFilter; categoryFilter: CategoryFilter; search: string; pageTop?: number };

export function PeopleScreen({ taskReturn }: { taskReturn?: PeopleTaskReturn } = {}) {
  const { currentUser, factoryId } = useAppStore();
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [passwordResetCapability, setPasswordResetCapability] = useState<PasswordResetCapability | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState<PasswordRecoveryResult | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [timeAreas, setTimeAreas] = useState<TimeArea[]>([]);
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>(taskReturn?.shiftFilter ?? 'all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(taskReturn?.categoryFilter ?? 'all');
  const [search, setSearch] = useState(taskReturn?.search ?? '');
  const [filterOpen, setFilterOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedNote, setSelectedNote] = useState<Profile['notes'][number] | null>(null);
  const [lineId, setLineId] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listReady, setListReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const listGeneration = React.useRef(0);
  const profileGeneration = React.useRef(0);
  const busy = loading || profileLoading;
  const [errorText, setErrorText] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);

  const closeProfile = () => {
    profileGeneration.current += 1;
    setProfileLoading(false);
    setProfile(null);
    setPasswordResetCapability(null);
    setPasswordRecovery(null);
    setPhotoFile(null);
    setSkillsOpen(false);
  };
  useBodyScrollLock(Boolean(profile));
  const returnProfileOpened = React.useRef(false);
  const returnScrollRestored = React.useRef(false);
  const returnScrollCancelled = React.useRef(false);
  useEffect(() => {
    const cancelPendingReturn = (event: Event) => {
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
      if (returnProfileOpened.current && !document.body.classList.contains('app-scroll-locked')) returnScrollCancelled.current = true;
    };
    for (const name of ['pointerdown', 'wheel', 'touchmove', 'keydown']) window.addEventListener(name, cancelPendingReturn, { passive: true });
    return () => {
      listGeneration.current += 1;
      profileGeneration.current += 1;
      for (const name of ['pointerdown', 'wheel', 'touchmove', 'keydown']) window.removeEventListener(name, cancelPendingReturn);
    };
  }, []);
  useEffect(() => {
    if (profile) { returnProfileOpened.current = true; return; }
    if (!taskReturn || taskReturn.pageTop === undefined || listLoading || !listReady || !returnProfileOpened.current || returnScrollRestored.current || returnScrollCancelled.current) return;
    const frame = requestAnimationFrame(() => {
      if (returnScrollCancelled.current || document.body.classList.contains('app-scroll-locked')) return;
      window.scrollTo({ top: taskReturn.pageTop, left: 0, behavior: 'auto' });
      returnScrollRestored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [profile, listLoading, listReady, taskReturn]);
  useMobileBackLayer(Boolean(profile) && !modal, closeProfile, 720);

  const canManageSkills = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('people.skills.manage'));
  const canManageNotes = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('people.notes.manage'));
  const canManageProfilePhoto = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('people.profile.manage')
    || currentUser?.permissions.includes('users.manage')
    || currentUser?.permissions.includes('assignments.manage')
    || ['MASTER', 'MANAGEMENT', 'ADMIN'].includes(currentUser?.role ?? ''),
  );
  const isStoreView = currentUser?.role === 'STORE';
  const canCheckPasswordReset = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('users.password.reset')
    || currentUser?.permissions.includes('admin.users.manage')
    || currentUser?.permissions.includes('company.members.manage')
    || currentUser?.permissions.includes('people.profile.manage'),
  );

  const load = async () => {
    const generation = ++listGeneration.current;
    const isCurrent = () => generation === listGeneration.current && appStore.getState().factoryId === factoryId;
    setListLoading(true);
    setListReady(false);
    setErrorText(null);
    try {
      const params = new URLSearchParams();
      if (shiftFilter === 'shift') params.set('onShift', 'true');
      const [data, areaRows] = await Promise.all([
        apiClient.get<PeopleResponse>(`/people?${params.toString()}`),
        isStoreView ? apiClient.get<TimeArea[]>('/work-areas').catch(() => []) : Promise.resolve([]),
      ]);
      if (!isCurrent()) return;
      setPeople(data.people);
      setTimeAreas(areaRows.filter((area) => area.assignmentKind === 'TIME'));
      if (canManageSkills) {
        const nextLines = await apiClient.get<Line[]>('/lines');
        if (!isCurrent()) return;
        setLines(nextLines);
      }
      setListReady(true);
    } catch (error) {
      if (!isCurrent()) return;
      setPeople([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить список людей.');
    } finally {
      if (isCurrent()) setListLoading(false);
    }
  };

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 140); };
    window.addEventListener('zavod:operational-data-invalidated', refresh);
    window.addEventListener('zavod:ws-reconnected', refresh);
    return () => {
      listGeneration.current += 1;
      clearTimeout(timer);
      window.removeEventListener('zavod:operational-data-invalidated', refresh);
      window.removeEventListener('zavod:ws-reconnected', refresh);
    };
  }, [shiftFilter, isStoreView, factoryId]);

  const filtered = useMemo(() => {
    const roles = roleFilters[categoryFilter];
    return people.filter((person) => {
      const roleOk = roles.length ? roles.includes(person.role) : true;
      const shiftOk = shiftFilter === 'shift'
        ? person.onShift
        : shiftFilter === 'offShift'
          ? !person.onShift
          : true;
      return roleOk && shiftOk;
    });
  }, [categoryFilter, people, shiftFilter]);

  const openProfile = async (userId: string) => {
    const generation = ++profileGeneration.current;
    const isCurrent = () => generation === profileGeneration.current && appStore.getState().factoryId === factoryId;
    setProfileLoading(true);
    setErrorText(null);
    setNoticeText(null);
    if (profile?.id !== userId) setSkillsOpen(false);
    try {
      const [nextProfile, resetCapability] = await Promise.all([
        apiClient.get<Profile>(`/people/${userId}`),
        canCheckPasswordReset
          ? apiClient.get<PasswordResetCapability>(`/admin/users/${userId}/password-reset/preview`).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!isCurrent()) return;
      setProfile(nextProfile);
      setPasswordResetCapability(resetCapability);
    } catch (error) {
      if (!isCurrent()) return;
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть профиль.');
    } finally {
      if (isCurrent()) setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    const id = profile.id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      const generation = profileGeneration.current;
      timer = setTimeout(() => {
        if (generation === profileGeneration.current && appStore.getState().factoryId === factoryId) void openProfile(id);
      }, 140);
    };
    window.addEventListener('zavod:operational-data-invalidated', refresh);
    window.addEventListener('zavod:ws-reconnected', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('zavod:operational-data-invalidated', refresh);
      window.removeEventListener('zavod:ws-reconnected', refresh);
    };
  }, [profile?.id, factoryId]);

  useEffect(() => {
    const onOpenPersonProfile = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (userId) void openProfile(userId);
    };
    window.addEventListener('zavod:open-person-profile', onOpenPersonProfile as EventListener);
    return () => window.removeEventListener('zavod:open-person-profile', onOpenPersonProfile as EventListener);
  }, []);

  useEffect(() => { if (taskReturn?.profileId) void openProfile(taskReturn.profileId); }, []);

  const currentLine = lines.find((line) => line.id === lineId);
  const skillFields: ActionModalField[] = [
    {
      name: 'positionId',
      label: 'Позиция',
      type: 'select',
      required: true,
      options: (currentLine?.positions ?? []).map((position) => ({ value: position.id, label: position.name })),
    },
    { name: 'experienceCount', label: 'Фактический опыт', type: 'number', defaultValue: 1, required: true },
  ];

  const createSkill = async (values: Record<string, string | boolean>) => {
    if (!profile) return;
    if (!lineId) {
      setErrorText('Выберите линию для навыка.');
      return;
    }
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/people/${profile.id}/skills`, {
        lineId,
        positionId: values.positionId,
        experienceCount: Number(values.experienceCount || 1),
      });
      setModal(null);
      setLineId('');
      await openProfile(profile.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось добавить навык.');
    } finally {
      setLoading(false);
    }
  };

  const updateSkill = async (values: Record<string, string | boolean>) => {
    if (!profile || !selectedSkill) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.patch(`/people/${profile.id}/skills/${selectedSkill.id}`, {
        experienceCount: Math.max(0, Number(values.experienceCount || 0)),
        isActive: Boolean(values.isActive),
      });
      setModal(null);
      setSelectedSkill(null);
      await openProfile(profile.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить навык.');
    } finally {
      setLoading(false);
    }
  };

  const primaryFactoryAccess = profile?.factoryAccesses.find((access) => access.isActive) ?? profile?.factoryAccesses[0] ?? null;
  const canManageThisProfilePhoto = Boolean(canManageProfilePhoto && profile && profile.id !== currentUser?.userId);
  const currentAssignmentLabel = profile?.currentAssignment
    ? profile.currentAssignment.lineName
      ? `${profile.currentAssignment.lineName}${profile.currentAssignment.positionName ? ` · ${profile.currentAssignment.positionName}` : ''}`
      : profile.currentAssignment.workAreaName
        ? compactDistinctLabels(profile.currentAssignment.workAreaName, profile.currentAssignment.workAreaPositionName)
        : profile.currentAssignment.timeRoleName ?? (profile.currentAssignment.washSessionId ? 'Мойка' : 'Назначение без линии')
    : 'Сейчас без назначения';

  const createNote = async (values: Record<string, string | boolean>) => {
    if (!profile) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/people/${profile.id}/notes`, { text: values.text, visibility: values.visibility });
      setModal(null);
      await openProfile(profile.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить заметку.');
    } finally {
      setLoading(false);
    }
  };

  const updateNote = async (values: Record<string, string | boolean>) => {
    if (!profile || !selectedNote) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.patch(`/people/${profile.id}/notes/${selectedNote.id}`, { text: values.text });
      setModal(null);
      setSelectedNote(null);
      await openProfile(profile.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось изменить заметку.');
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = async () => {
    if (!profile || !selectedNote) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.request(`/people/${profile.id}/notes/${selectedNote.id}`, { method: 'DELETE' });
      setModal(null);
      setSelectedNote(null);
      await openProfile(profile.id);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось удалить заметку.');
    } finally {
      setLoading(false);
    }
  };

  const uploadProfilePhoto = async () => {
    if (!profile || !photoFile) return;
    setLoading(true);
    setErrorText(null);
    try {
      const form = new FormData();
      form.append('file', photoFile);
      await apiClient.upload(`/people/${profile.id}/photo`, form);
      setPhotoFile(null);
      await openProfile(profile.id);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить фото профиля.');
    } finally {
      setLoading(false);
    }
  };

  const deleteProfilePhoto = async () => {
    if (!profile) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.request(`/people/${profile.id}/photo`, { method: 'DELETE' });
      setPhotoFile(null);
      await openProfile(profile.id);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось удалить фото профиля.');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (values: Record<string, string | boolean>) => {
    if (!profile) return;
    setLoading(true);
    setErrorText(null);
    setNoticeText(null);
    try {
      const result = await apiClient.post<PasswordRecoveryResult>(`/admin/users/${profile.id}/password-reset`, {
        reason: String(values.reason ?? '').trim(),
      });
      setPasswordRecovery(result);
      setModal('password-recovery-issued');
      setPasswordResetCapability((current) => current ? {
        ...current,
        passwordResetRequired: true,
        recoveryActive: true,
        recoveryExpiresAt: result.recoveryExpiresAt,
      } : current);
      setNoticeText(result.replacedExisting
        ? 'Предыдущий временный код отозван. Передайте сотруднику новый код.'
        : 'Временный код создан. Передайте его сотруднику после проверки личности.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сбросить пароль.');
    } finally {
      setLoading(false);
    }
  };

  const closePasswordRecovery = () => {
    setPasswordRecovery(null);
    setModal(null);
  };

  const copyPasswordRecovery = async () => {
    if (!passwordRecovery) return;
    try {
      await navigator.clipboard.writeText(passwordRecovery.recoveryCredential);
      setNoticeText('Временный код скопирован. Не сохраняйте его в чатах или заметках.');
    } catch {
      setNoticeText('Не удалось скопировать автоматически. Выделите код и скопируйте вручную.');
    }
  };

  return (
    <section className="screen-panel">
      <PremiumSectionHeader
        title="Люди"
        subtitle={isStoreView
          ? 'Свободные работники и позиции повременщиков текущего завода.'
          : 'Рабочий список сотрудников, профиль, навыки по линиям и управленческие заметки без HR-учёта.'}
      />

      <PremiumKpiStrip
        className="people-kpi-strip"
        items={[
          { label: 'Всего', value: people.length, icon: 'Σ', tone: 'neutral' },
          { label: 'На смене', value: people.filter((person) => person.onShift).length, icon: '●', tone: 'success' },
          { label: 'Вне смены', value: people.filter((person) => !person.onShift).length, icon: '○', tone: 'muted' },
        ]}
        label="Состояние сотрудников"
      />

      {isStoreView ? (
        <section className="card" data-testid="store-time-areas">
          <div className="section-subhead"><h3>Повременщики</h3><span>{timeAreas.length}</span></div>
          <div className="section-stack">
            {!listLoading && !timeAreas.length ? <div className="empty-state compact">Позиции повременщиков пока не настроены</div> : null}
            {timeAreas.map((area) => {
              const actual = area.shortageSummary?.reduce((sum, item) => sum + item.actual, 0) ?? 0;
              const planned = area.shortageSummary?.reduce((sum, item) => sum + item.plannedCount, 0) ?? 0;
              return (
                <article className="position-row" key={area.id}>
                  <div>
                    <strong>{area.name}</strong>
                    <span>{area.shortageSummary?.map((item) => `${item.title}: ${item.actual}/${item.plannedCount}`).join(' · ') || 'Позиции не настроены'}</span>
                  </div>
                  <span className="tag">{actual}/{planned}</span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {!isStoreView ? <div className="people-compact-controls">
        <span className="premium-segmented-control people-shift-tabs" style={{ '--segments': 3 } as React.CSSProperties}>
          {shiftFilters.map(([value, label]) => (
            <button aria-pressed={shiftFilter === value} className={shiftFilter === value ? 'active' : ''} key={value} type="button" onClick={() => setShiftFilter(value)}>
              {label}
            </button>
          ))}
        </span>
        <div className="premium-filter-trigger-row">
          <button className="secondary-button" type="button" onClick={() => setFilterOpen(true)}>Поиск и фильтры</button>
          <span className="premium-filter-summary">
            {categoryFilters.find(([value]) => value === categoryFilter)?.[1] ?? 'Все роли'} · показано {filtered.length}
          </span>
          <button className="secondary-button compact-action" type="button" onClick={() => void load()}>Обновить</button>
        </div>
      </div> : null}

      <PremiumSheet
        open={filterOpen}
        title="Поиск и фильтры"
        description="Поиск работает во всей доступной вам области выбранного завода."
        onClose={() => setFilterOpen(false)}
        footer={(
          <>
            <button className="secondary-button" type="button" onClick={() => { setSearch(''); setCategoryFilter('all'); }}>Сбросить</button>
            <button className="primary-button" type="button" onClick={() => setFilterOpen(false)}>Показать</button>
          </>
        )}
      >
        <div className="premium-filter-form">
          <label>
            Категория сотрудников
            <span className="premium-segmented-control people-category-tabs" style={{ '--segments': 2 } as React.CSSProperties}>
              {categoryFilters.map(([value, label]) => (
                <button aria-pressed={categoryFilter === value} className={categoryFilter === value ? 'active' : ''} key={value} type="button" onClick={() => setCategoryFilter(value)}>
                  {label}
                </button>
              ))}
            </span>
          </label>
          <PeopleSearchPanel
            mode="PEOPLE_DIRECTORY"
            value={search}
            onChange={setSearch}
            onSelect={(result) => { setFilterOpen(false); void openProfile(result.userId); }}
          />
        </div>
      </PremiumSheet>

      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {noticeText ? <div className="empty-state success-state" role="status">{noticeText}</div> : null}
      {listLoading ? <div className="empty-state compact">Загрузка людей...</div> : null}
      {profileLoading ? <span className="visually-hidden" role="status">Загрузка профиля...</span> : null}

      <div className="section-subhead compact-heading people-current-list-heading"><h3>Текущий список</h3><span>{filtered.length}</span></div>
      <div className="section-stack">
        {!filtered.length && !listLoading ? <div className="empty-state">Людей в доступной области пока нет.</div> : null}
        {filtered.map((person) => (
          <button className={`card people-compact-row ${person.onShift ? 'on-shift' : 'off-shift'}`} key={person.userId} type="button" onClick={() => void openProfile(person.userId)}>
            <ProfilePhoto photo={person.profilePhoto} userId={person.userId} displayName={person.displayName} size="small" />
            <div className="people-compact-row-copy">
              <span className="people-compact-row-title">
                <strong>{shortPersonName(person.userId, person.displayName)}</strong>
                <span className={person.onShift ? 'people-inline-status work' : 'people-inline-status'}>
                  {person.onShift ? 'На смене' : displayLabel(employeeStateLabels, person.employeeState)}
                </span>
              </span>
              <span>{compactDistinctLabels(roleLabel(person.role), person.departmentName) || 'Отдел не указан'}</span>
            </div>
            <span className="people-row-open">Открыть</span>
          </button>
        ))}
      </div>

      {profile ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card profile-card">
            <div className="profile-card-body">
            <div className="profile-hero profile-hero-rich">
              <div className="profile-title-panel profile-title-panel-with-photo">
                <ProfilePhoto photo={profile.profilePhoto} userId={profile.id} displayName={profile.displayName} size="large" />
                <div className="profile-title-content">
                  <span className="eyebrow">Карточка сотрудника</span>
                  <h3>{shortPersonName(profile.id, profile.displayName)}</h3>
                  <div className="profile-status-grid">
                    <span className="tag">{compactDistinctLabels(roleLabel(profile.role), profile.departmentName ?? primaryFactoryAccess?.departmentName) || 'Отдел не указан'}</span>
                    <span className={`tag ${profile.onShift ? 'work' : ''}`}>{profile.onShift ? 'На смене' : displayLabel(employeeStateLabels, profile.employeeState)}</span>
                    <span className="tag">{profile.phoneLabel}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="profile-photo-panel profile-photo-management">
              <span className="profile-photo-caption">
                Фото ведёт мастер или руководитель
              </span>
              {canManageThisProfilePhoto ? (
                <div className="profile-photo-actions">
                  <label className="secondary-button compact-action profile-photo-file">
                    {profile.profilePhoto ? 'Заменить' : 'Добавить фото'}
                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      type="file"
                      onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {photoFile ? <span className="profile-photo-caption selected-file">{photoFile.name}</span> : null}
                  {photoFile ? <button className="primary-button compact-action" disabled={busy} type="button" onClick={() => void uploadProfilePhoto()}>Загрузить</button> : null}
                  {profile.profilePhoto ? <button className="secondary-button compact-action danger" disabled={busy} type="button" onClick={() => void deleteProfilePhoto()}>Удалить</button> : null}
                </div>
              ) : null}
            </div>
            <div className="profile-current-assignment">
              <span>Текущее назначение · {primaryFactoryAccess?.factoryName ?? 'Завод не указан'}</span>
              <strong>{currentAssignmentLabel}</strong>
              {profile.currentAssignment?.startedAt ? <small>С {new Date(profile.currentAssignment.startedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small> : null}
            </div>
            <div className="profile-sections">
              {profile.serviceTaskStatus ? (
                <section className="profile-section-card service-status-card">
                  <h4>Статус службы</h4>
                  <div className="position-row">
                    <div>
                      <strong>{profile.serviceTaskStatus.label}</strong>
                      <span>
                        {profile.serviceTaskStatus.state === 'ON_TASK'
                          ? `${profile.serviceTaskStatus.title ?? 'Заявка'}${profile.serviceTaskStatus.lineName ? ` · ${profile.serviceTaskStatus.lineName}` : ''}`
                          : 'Активной заявки в работе нет'}
                      </span>
                    </div>
                    {profile.serviceTaskStatus.state === 'ON_TASK' ? (
                      <button className="secondary-button" type="button" onClick={() => {
                        window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: {
                          screen: 'Tasks', taskId: profile.serviceTaskStatus?.taskId,
                          taskReturn: { profileId: profile.id, shiftFilter, categoryFilter, search,
                            pageTop: document.body.style.position === 'fixed' ? -(parseFloat(document.body.style.top) || 0) : window.scrollY,
                          } satisfies PeopleTaskReturn,
                        } }));
                      }}>
                        Посмотреть заявку
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {isAssignableRole(profile.role) ? (
                <section className="profile-section-card profile-skills-section">
                  <button
                    aria-expanded={skillsOpen}
                    className="profile-section-toggle"
                    type="button"
                    onClick={() => setSkillsOpen((value) => !value)}
                  >
                    <span>
                      <strong>Навыки по линиям</strong>
                      <small>Линия, позиция, стаж и уровень</small>
                    </span>
                    <span className="count-badge">{profile.skills.length}</span>
                  </button>
                  {skillsOpen ? (
                    <div className="profile-collapsible-body">
                      {!profile.skills.length ? <div className="empty-state compact">Навыки пока не указаны.</div> : null}
                      {profile.skills.map((skill) => (
                        <div className={`profile-skill-compact skill-${skill.color || 'orange'}`} key={skill.id}>
                          <div>
                            <strong>{skill.lineName ?? 'Линия не указана'} · {skill.positionName ?? 'Позиция не указана'}</strong>
                            <span>{skill.level} · стаж {skill.experienceCount} · {skill.recommended ? 'рекомендован' : 'без рекомендации'}</span>
                          </div>
                          {canManageSkills ? (
                            <button className="secondary-button compact-action" type="button" onClick={() => { setSelectedSkill(skill); setModal('edit-skill'); }}>
                              Изменить
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {canManageSkills ? <button className="primary-button compact-action" type="button" onClick={() => { setLineId(''); setModal('skill'); }}>Добавить навык</button> : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
              <section className="profile-section-card">
                <h4>Заметки руководства</h4>
                {!profile.notes.length ? <div className="empty-state compact">Заметок пока нет.</div> : null}
                {profile.notes.map((note) => (
                  <div className="position-row" key={note.id}>
                    <div><strong>Заметка</strong><span>{note.text}</span></div>
                    {canManageNotes ? (
                      <div className="button-row">
                        <button className="secondary-button" type="button" onClick={() => { setSelectedNote(note); setModal('edit-note'); }}>Изменить</button>
                        <button className="secondary-button danger" type="button" onClick={() => { setSelectedNote(note); setModal('delete-note'); }}>Удалить</button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {canManageNotes ? <button className="primary-button" type="button" onClick={() => setModal('note')}>Добавить заметку</button> : null}
              </section>
              <section className="profile-section-card">
                <h4>Доступы</h4>
                {profile.factoryAccesses.map((access) => (
                  <div className="position-row" key={`${access.factoryName}-${access.role}`}>
                    <div>
                      <strong>{access.factoryName}</strong>
                      <span>{roleLabel(access.role)} · {access.departmentName ?? 'Без отдела'} · {access.isActive ? 'активен' : 'выключен'}</span>
                    </div>
                  </div>
                ))}
                {passwordResetCapability?.allowed ? (
                  <div className="position-row">
                    <div>
                      <strong>Пароль</strong>
                      <span>
                        {passwordResetCapability.recoveryActive
                          ? 'Активен временный одноразовый код. Повторная выдача сразу отзовёт прежний.'
                          : passwordResetCapability.passwordResetRequired
                            ? 'Требуется новый временный код или завершение уже начатой установки пароля.'
                          : 'Сброс завершит действующие сессии сотрудника.'}
                      </span>
                    </div>
                    <button
                      className="secondary-button danger"
                      disabled={busy}
                      type="button"
                      onClick={() => setModal('password-reset')}
                    >
                      {passwordResetCapability.passwordResetRequired ? 'Выдать новый код' : 'Сбросить пароль'}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeProfile}>Закрыть окно</button>
              <button className="primary-button" type="button" onClick={() => void openProfile(profile.id)}>Обновить</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'skill' ? (
        <ActionModal
          busy={busy}
          dirty={Boolean(lineId)}
          fields={skillFields}
          title="Добавить навык"
          confirmLabel="Добавить"
          onCancel={() => { setModal(null); setLineId(''); }}
          onSubmit={createSkill}
        >
          <label className="field-label">
            Линия
            <select value={lineId} onChange={(event) => setLineId(event.target.value)}>
              <option value="">Не выбрано</option>
              {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </label>
        </ActionModal>
      ) : null}

      {modal === 'edit-skill' && selectedSkill ? (
        <ActionModal
          busy={busy}
          description="Автоматическое начисление остаётся основным. Здесь руководитель может исправить подтверждённую ошибку учёта."
          fields={[
            { name: 'experienceCount', label: 'Фактический опыт', type: 'number', required: true, defaultValue: selectedSkill.experienceCount },
            { name: 'isActive', label: 'Навык активен', type: 'checkbox', defaultValue: true },
          ]}
          title="Изменить навык"
          confirmLabel="Сохранить"
          onCancel={() => { setModal(null); setSelectedSkill(null); }}
          onSubmit={updateSkill}
        />
      ) : null}

      {modal === 'note' ? (
        <ActionModal
          busy={busy}
          fields={[
            { name: 'text', label: 'Заметка', type: 'textarea', required: true },
            {
              name: 'visibility',
              label: 'Видимость',
              type: 'select',
              defaultValue: 'MANAGEMENT',
              options: [{ label: 'Руководство', value: 'MANAGEMENT' }, { label: 'Только администратор', value: 'ADMIN' }],
            },
          ]}
          title="Заметка руководства"
          confirmLabel="Сохранить"
          onCancel={() => setModal(null)}
          onSubmit={createNote}
        />
      ) : null}

      {modal === 'edit-note' && selectedNote ? (
        <ActionModal
          busy={busy}
          fields={[{ name: 'text', label: 'Заметка', type: 'textarea', required: true, defaultValue: selectedNote.text }]}
          title="Изменить заметку"
          confirmLabel="Сохранить"
          onCancel={() => setModal(null)}
          onSubmit={updateNote}
        />
      ) : null}

      {modal === 'delete-note' && selectedNote ? (
        <ActionModal
          busy={busy}
          title="Удалить заметку"
          description="Заметка будет скрыта, физическое удаление не выполняется."
          confirmLabel="Удалить"
          onCancel={() => setModal(null)}
          onSubmit={deleteNote}
        />
      ) : null}

      {modal === 'password-reset' && profile ? (
        <ActionModal
          busy={busy}
          title="Сбросить пароль"
          description={`Действующие сессии сотрудника «${profile.displayName}» завершатся. Будет создан один временный код. Повторная выдача отзовёт прежний код и незавершённую установку пароля.`}
          fields={[{ name: 'reason', label: 'Причина', type: 'textarea', required: true }]}
          confirmLabel="Сбросить пароль"
          onCancel={() => setModal(null)}
          onSubmit={resetPassword}
        />
      ) : null}

      {modal === 'password-recovery-issued' && profile && passwordRecovery ? (
        <ActionModal
          busy={busy}
          title="Временный код создан"
          description={`Покажите код сотруднику «${profile.displayName}» только после проверки личности. Код отображается здесь один раз и не сохраняется в профиле.`}
          confirmLabel="Код передан"
          cancelLabel="Закрыть"
          onCancel={closePasswordRecovery}
          onSubmit={closePasswordRecovery}
        >
          <div className="onboarding-status-card" role="status">
            <strong>Временный код</strong>
            <code data-testid="password-recovery-credential">{passwordRecovery.recoveryCredential}</code>
            <p>Действует до {new Date(passwordRecovery.recoveryExpiresAt).toLocaleString('ru-RU')}. Не отправляйте код в общий чат и не сохраняйте в заметках.</p>
            <button className="secondary-button" onClick={() => void copyPasswordRecovery()} type="button">Копировать код</button>
          </div>
        </ActionModal>
      ) : null}
    </section>
  );
}

