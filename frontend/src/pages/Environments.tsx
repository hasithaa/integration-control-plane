/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Alert, Avatar, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, PageContent, PageTitle, Stack, ListingTable, TablePagination, TextField, Tooltip, Typography } from '@wso2/oxygen-ui';
import { Clock, Layers, Pencil, Plus, Trash2, AlertTriangle } from '@wso2/oxygen-ui-icons-react';
import { useState, useMemo, useEffect, type JSX } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAllEnvironments, type GqlEnvironment } from '../api/queries';
import { useDeleteEnvironment } from '../api/mutations';
import { editEnvironmentUrl } from '../paths';
import EmptyListing from '../components/EmptyListing';
import SearchField from '../components/SearchField';
import { formatDistanceToNow } from '../utils/time';
import { newEnvironmentUrl, type OrgScope, type ProjectScope } from '../nav';
import { useAccessControl } from '../contexts/AccessControlContext';
import { Permissions } from '../constants/permissions';
import Authorized from '../components/Authorized';

function formatErrorMessage(error: Error, action: 'create' | 'update' | 'delete'): string {
  const message = error.message || '';

  // Check for duplicate/conflict errors
  if (message.toLowerCase().includes('already exists') || message.toLowerCase().includes('duplicate')) {
    return 'An environment with this name already exists. Please choose a different name.';
  }

  // Check for validation errors
  if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('validation')) {
    return `Invalid input: ${message}`;
  }

  // Check for permission errors
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('forbidden')) {
    return `You do not have permission to ${action} environments.`;
  }

  // Check for in-use/dependency errors for delete
  if (action === 'delete' && (message.toLowerCase().includes('in use') || message.toLowerCase().includes('referenced') || message.toLowerCase().includes('dependency'))) {
    return 'This environment cannot be deleted because it is currently in use.';
  }

  // Return the original message if it's meaningful, otherwise use a generic message
  if (message && !message.toLowerCase().includes('unexpected') && !message.toLowerCase().includes('administrator')) {
    return message;
  }

  return `Failed to ${action} environment. Please try again.`;
}

function DeleteDialog({ env, onClose, onSuccess, onError }: { env: GqlEnvironment; onClose: () => void; onSuccess: (name: string) => void; onError: (error: Error) => void }) {
  const [confirm, setConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mutation = useDeleteEnvironment();

  const doDelete = () => {
    setDeleteError(null);
    mutation.mutate(env.id, {
      onSuccess: () => {
        onClose();
        onSuccess(env.name);
      },
      onError: (error) => {
        const message = error.message || '';
        if (message.toLowerCase().includes('runtime')) {
          setDeleteError(message);
        } else {
          onClose();
          onError(error);
        }
      },
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          Are you sure you want to delete the environment '{env.name}'?
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This action is irreversible and will permanently remove all active integrations from this environment (including other configurations and data associated with this environment).
        </Typography>
        {deleteError ? (
          <Alert severity="error" icon={<AlertTriangle size={20} />} sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
            {deleteError}
          </Alert>
        ) : (
          <Alert severity="warning" icon={<AlertTriangle size={20} />} sx={{ mb: 2 }}>
            Deleting the environment will remove control plane data and may cause data inconsistencies.
          </Alert>
        )}
        <Typography variant="body2" sx={{ mb: 1 }}>
          Type the environment name to confirm
        </Typography>
        <TextField placeholder="Enter environment name" value={confirm} onChange={(e) => setConfirm(e.target.value)} fullWidth />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={doDelete} disabled={confirm !== env.name || mutation.isPending}>
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Environments(scope: OrgScope | ProjectScope): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasOrgPermission } = useAccessControl();
  const canManageEnv = hasOrgPermission(Permissions.ENVIRONMENT_MANAGE);
  const { data: environments, isLoading } = useAllEnvironments();
  const [deleting, setDeleting] = useState<GqlEnvironment | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // Sorting state: key = column, direction = 'asc' | 'desc'
  const [sort, setSort] = useState<{ key: keyof GqlEnvironment | 'type' | 'createdAt'; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });

  useEffect(() => {
    const state = location.state as { success?: boolean; environmentName?: string; updated?: boolean; name?: string } | null;
    if (state?.success && state.environmentName) {
      setAlert({ type: 'success', message: `Environment '${state.environmentName}' created successfully.` });
      navigate(location.pathname, { replace: true, state: null });
    } else if (state?.updated && state.name) {
      setAlert({ type: 'success', message: `Environment '${state.name}' updated successfully.` });
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const filteredEnvironments = useMemo(() => {
    if (!environments) return [];
    if (!search.trim()) return environments;
    const s = search.trim().toLowerCase();
    return environments.filter(
      (env) =>
        env.name.toLowerCase().includes(s) ||
        env.handler.toLowerCase().includes(s) ||
        (env.description?.toLowerCase() ?? '').includes(s) ||
        (env.critical ? 'critical' : 'non-critical').includes(s) ||
        (env.createdAt ? formatDistanceToNow(env.createdAt).toLowerCase() : '').includes(s),
    );
  }, [environments, search]);

  // Sorting logic
  const sortedEnvironments = useMemo(() => {
    const { key, direction } = sort;
    return [...filteredEnvironments].sort((a, b) => {
      let aValue: any = a[key as keyof GqlEnvironment];
      let bValue: any = b[key as keyof GqlEnvironment];
      if (key === 'type') {
        aValue = a.critical ? 'Critical' : 'Non-Critical';
        bValue = b.critical ? 'Critical' : 'Non-Critical';
      }
      if (key === 'createdAt') {
        aValue = a.createdAt;
        bValue = b.createdAt;
      }
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const cmp = aValue.localeCompare(bValue);
        return direction === 'asc' ? cmp : -cmp;
      }
      if (aValue instanceof Date && bValue instanceof Date) {
        return direction === 'asc' ? aValue.getTime() - bValue.getTime() : bValue.getTime() - aValue.getTime();
      }
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      // Fallback to string compare
      const cmp = String(aValue ?? '').localeCompare(String(bValue ?? ''));
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredEnvironments, sort]);

  const maxPage = Math.max(0, Math.ceil(sortedEnvironments.length / rowsPerPage) - 1);
  const safePage = Math.min(page, maxPage);
  const paginatedEnvironments = sortedEnvironments.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);

  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Header>Environments</PageTitle.Header>
      </PageTitle>

      {isLoading ? (
        <CircularProgress sx={{ display: 'block', mx: 'auto', py: 8 }} />
      ) : !environments?.length ? (
        <EmptyListing icon={<Layers size={48} />} title="No environments found" description="Create your first environment to get started" showAction={canManageEnv} actionLabel="Create Environment" onAction={() => navigate(newEnvironmentUrl(scope))} />
      ) : (
        <>
          {alert && (
            <Alert severity={alert.type} onClose={() => setAlert(null)} sx={{ mb: 2 }}>
              {alert.message}
            </Alert>
          )}
          <ListingTable.Container>
            <ListingTable.Toolbar
              searchSlot={<SearchField value={search} onChange={setSearch} />}
              actions={
                <Authorized permissions={Permissions.ENVIRONMENT_MANAGE}>
                  <Button variant="contained" startIcon={<Plus size={20} />} onClick={() => navigate(newEnvironmentUrl(scope))}>
                    Create Environment
                  </Button>
                </Authorized>
              }
            />
            <ListingTable>
              <ListingTable.Head>
                <ListingTable.Row>
                  <ListingTable.Cell>
                    <ListingTable.SortLabel active={sort.key === 'name'} direction={sort.key === 'name' ? sort.direction : 'asc'} onClick={() => setSort((prev) => ({ key: 'name', direction: prev.key === 'name' && prev.direction === 'asc' ? 'desc' : 'asc' }))}>
                      Name
                    </ListingTable.SortLabel>
                  </ListingTable.Cell>
                  <ListingTable.Cell>
                    <ListingTable.SortLabel
                      active={sort.key === 'handler'}
                      direction={sort.key === 'handler' ? sort.direction : 'asc'}
                      onClick={() => setSort((prev) => ({ key: 'handler', direction: prev.key === 'handler' && prev.direction === 'asc' ? 'desc' : 'asc' }))}>
                      Handler
                    </ListingTable.SortLabel>
                  </ListingTable.Cell>
                  <ListingTable.Cell>
                    <ListingTable.SortLabel
                      active={sort.key === 'description'}
                      direction={sort.key === 'description' ? sort.direction : 'asc'}
                      onClick={() => setSort((prev) => ({ key: 'description', direction: prev.key === 'description' && prev.direction === 'asc' ? 'desc' : 'asc' }))}>
                      Description
                    </ListingTable.SortLabel>
                  </ListingTable.Cell>
                  <ListingTable.Cell>
                    <ListingTable.SortLabel active={sort.key === 'type'} direction={sort.key === 'type' ? sort.direction : 'asc'} onClick={() => setSort((prev) => ({ key: 'type', direction: prev.key === 'type' && prev.direction === 'asc' ? 'desc' : 'asc' }))}>
                      Type
                    </ListingTable.SortLabel>
                  </ListingTable.Cell>
                  <ListingTable.Cell>
                    <ListingTable.SortLabel
                      active={sort.key === 'createdAt'}
                      direction={sort.key === 'createdAt' ? sort.direction : 'asc'}
                      onClick={() => setSort((prev) => ({ key: 'createdAt', direction: prev.key === 'createdAt' && prev.direction === 'asc' ? 'desc' : 'asc' }))}>
                      Created
                    </ListingTable.SortLabel>
                  </ListingTable.Cell>
                  <ListingTable.Cell align="right">Action</ListingTable.Cell>
                </ListingTable.Row>
              </ListingTable.Head>
              <ListingTable.Body>
                {sortedEnvironments.length === 0 ? (
                  <ListingTable.Row>
                    <ListingTable.Cell colSpan={6} align="center">
                      No records to display
                    </ListingTable.Cell>
                  </ListingTable.Row>
                ) : (
                  paginatedEnvironments.map((env) => (
                    <ListingTable.Row key={env.id}>
                      <ListingTable.Cell>
                        <Stack direction="row" alignItems="center" gap={1.5}>
                          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: 'action.hover', color: 'text.secondary' }}>{env.name[0]?.toUpperCase()}</Avatar>
                          {env.name}
                        </Stack>
                      </ListingTable.Cell>
                      <ListingTable.Cell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                          {env.handler}
                        </Typography>
                      </ListingTable.Cell>
                      <ListingTable.Cell>{env.description}</ListingTable.Cell>
                      <ListingTable.Cell>{env.critical ? 'Critical' : 'Non-Critical'}</ListingTable.Cell>
                      <ListingTable.Cell>
                        <Stack direction="row" alignItems="center" gap={0.5}>
                          <Clock size={14} />
                          {env.createdAt ? formatDistanceToNow(env.createdAt) : '—'}
                        </Stack>
                      </ListingTable.Cell>
                      <Authorized permissions={Permissions.ENVIRONMENT_MANAGE} fallback={<ListingTable.Cell align="right" />}>
                        <ListingTable.Cell align="right">
                          <Tooltip title="Edit">
                            <IconButton size="small" aria-label={`Edit ${env.name}`} onClick={() => navigate(editEnvironmentUrl(scope.org, env.id))}>
                              <Pencil size={16} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" color="error" aria-label={`Delete ${env.name}`} onClick={() => setDeleting(env)}>
                              <Trash2 size={16} />
                            </IconButton>
                          </Tooltip>
                        </ListingTable.Cell>
                      </Authorized>
                    </ListingTable.Row>
                  ))
                )}
              </ListingTable.Body>
            </ListingTable>
            <TablePagination
              sx={{ borderTop: '1px solid', borderColor: 'divider' }}
              component="div"
              count={filteredEnvironments.length}
              page={safePage}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25, 50]}
            />
          </ListingTable.Container>
        </>
      )}

      {deleting && (
        <DeleteDialog
          env={deleting}
          onClose={() => setDeleting(null)}
          onSuccess={(name) => setAlert({ type: 'success', message: `Environment '${name}' deleted successfully.` })}
          onError={(error) => setAlert({ type: 'error', message: formatErrorMessage(error, 'delete') })}
        />
      )}
    </PageContent>
  );
}
