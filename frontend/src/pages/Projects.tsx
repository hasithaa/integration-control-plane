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

import {
  Alert,
  Avatar,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  PageContent,
  PageTitle,
  Stack,
  TablePagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@wso2/oxygen-ui';
import { Clock, Folder, LayoutGrid, List, Pencil, Plus, RefreshCw, Trash2 } from '@wso2/oxygen-ui-icons-react';
import SearchField from '../components/SearchField';
import { useNavigate } from 'react-router';
import { useState, type JSX } from 'react';
import { useProjectsPage, type GqlProject } from '../api/queries';
import { useDeleteProject } from '../api/mutations';
import EmptyListing from '../components/EmptyListing';
import { formatDistanceToNow } from '../utils/time';
import { resourceUrl, narrow, newProjectUrl, type OrgScope } from '../nav';
import { editProjectUrl } from '../paths';
import { useAccessControl } from '../contexts/AccessControlContext';
import { Permissions } from '../constants/permissions';
import Authorized from '../components/Authorized';

function ProjectCard({ project, onClick, onSettings, onDelete }: { project: GqlProject; onClick: () => void; onSettings: () => void; onDelete: () => void }) {
  return (
    <Card variant="outlined" sx={{ cursor: 'pointer', '&:hover': { boxShadow: 2 } }} onClick={onClick}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
        <Avatar sx={{ bgcolor: 'action.hover', color: 'text.secondary', width: 48, height: 48 }}>{project.name[0].toUpperCase()}</Avatar>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {project.name}
        </Typography>
      </CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, pb: 2 }}>
        <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
          <Clock size={14} />
          {formatDistanceToNow(project.updatedAt)}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Authorized permissions={Permissions.PROJECT_MANAGE}>
            <IconButton
              size="small"
              aria-label={`Edit ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onSettings();
              }}>
              <Pencil size={16} />
            </IconButton>
            <IconButton
              size="small"
              color="error"
              aria-label={`Delete ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}>
              <Trash2 size={16} />
            </IconButton>
          </Authorized>
        </Stack>
      </Stack>
    </Card>
  );
}

function ProjectListItem({ project, onClick, onSettings, onDelete }: { project: GqlProject; onClick: () => void; onSettings: () => void; onDelete: () => void }) {
  return (
    <Card variant="outlined" sx={{ cursor: 'pointer', '&:hover': { boxShadow: 1 } }} onClick={onClick}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
        <Avatar sx={{ bgcolor: 'action.hover', color: 'text.secondary', width: 40, height: 40 }}>{project.name[0].toUpperCase()}</Avatar>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }} noWrap>
            {project.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Updated {formatDistanceToNow(project.updatedAt)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <Authorized permissions={Permissions.PROJECT_MANAGE}>
            <IconButton
              size="small"
              aria-label={`Edit ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onSettings();
              }}>
              <Pencil size={16} />
            </IconButton>
            <IconButton
              size="small"
              color="error"
              aria-label={`Delete ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}>
              <Trash2 size={16} />
            </IconButton>
          </Authorized>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function Projects(scope: OrgScope): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<GqlProject | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const { hasOrgPermission } = useAccessControl();
  const canCreateProject = hasOrgPermission(Permissions.PROJECT_MANAGE);
  const { data, isLoading, refetch } = useProjectsPage(query ? 500 : rowsPerPage, query ? 0 : page * rowsPerPage);
  const projects = data?.items ?? [];
  const serverTotal = data?.pageInfo?.total ?? 0;
  const deleteMutation = useDeleteProject();

  const handleDeleteClick = (project: GqlProject) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
    setDeleteError(null);
    setConfirmText('');
  };

  const handleDeleteConfirm = () => {
    if (!projectToDelete) return;
    setDeleteError(null);
    deleteMutation.mutate(
      { orgId: projectToDelete.orgId, projectId: projectToDelete.id },
      {
        onSuccess: (result) => {
          if (result.status === 'success') {
            if (page > 0 && page * rowsPerPage >= total - 1) setPage((p) => p - 1);
            setDeleteDialogOpen(false);
            setProjectToDelete(null);
            setConfirmText('');
          } else {
            const statusMsg = result.status ? ` (Status: ${result.status})` : '';
            setDeleteError(result.details ?? `Failed to delete project. Please try again.${statusMsg}`);
          }
        },
        onError: (err) => setDeleteError(err.message ?? 'Failed to delete project. Please try again.'),
      },
    );
  };

  const handleCloseDialog = () => {
    // Prevent closing while delete is in progress
    if (deleteMutation.isPending) return;
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
    setDeleteError(null);
    setConfirmText('');
  };

  const filtered = projects.filter((p) => {
    if (!query) return true;
    const searchQuery = query.trim().toLowerCase();
    return p.name.toLowerCase().includes(searchQuery) || p.description?.toLowerCase().includes(searchQuery) || p.handler.toLowerCase().includes(searchQuery) || p.region?.toLowerCase().includes(searchQuery) || p.type?.toLowerCase().includes(searchQuery);
  });
  const displayItems = query ? filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage) : filtered;
  const total = query ? filtered.length : serverTotal;

  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Header>
          <Stack direction="row" alignItems="center" gap={1}>
            All Projects
            <IconButton size="small" aria-label="Refresh projects" onClick={() => refetch()}>
              <RefreshCw size={18} />
            </IconButton>
          </Stack>
        </PageTitle.Header>
        <PageTitle.Actions>
          <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
            <ToggleButton value="grid" aria-label="Grid view">
              <LayoutGrid size={18} />
            </ToggleButton>
            <ToggleButton value="list" aria-label="List view">
              <List size={18} />
            </ToggleButton>
          </ToggleButtonGroup>
        </PageTitle.Actions>
      </PageTitle>

      <Stack direction="row" gap={2} alignItems="center" sx={{ mb: 3 }}>
        <SearchField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
          placeholder="Search projects"
          fullWidth
        />
        <Authorized permissions={Permissions.PROJECT_MANAGE}>
          <Button variant="contained" startIcon={<Plus size={20} />} onClick={() => navigate(newProjectUrl(scope))} sx={{ whiteSpace: 'nowrap' }}>
            Create Project
          </Button>
        </Authorized>
      </Stack>

      {isLoading ? (
        <CircularProgress sx={{ display: 'block', mx: 'auto', py: 8 }} />
      ) : total === 0 && !query ? (
        <EmptyListing
          icon={<Folder size={48} />}
          title="No projects found"
          description={canCreateProject ? 'Add your runtime or create a project to get started.' : 'Ask your administrator for access'}
          showAction={canCreateProject}
          actionLabel="Add Runtime"
          onAction={() => navigate(`${resourceUrl(scope, 'runtimes')}?action=add-runtime`)}
        />
      ) : filtered.length === 0 ? (
        <EmptyListing icon={<Folder size={48} />} title="No projects match your search" description="Try adjusting your search terms" showAction={false} />
      ) : (
        <>
          {view === 'grid' ? (
            <Grid container spacing={2}>
              {displayItems.map((p) => (
                <Grid key={p.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <ProjectCard project={p} onClick={() => navigate(resourceUrl(narrow(scope, p.handler), 'overview'))} onSettings={() => navigate(editProjectUrl(scope.org, p.id))} onDelete={() => handleDeleteClick(p)} />
                </Grid>
              ))}
            </Grid>
          ) : (
            <Stack spacing={1.5}>
              {displayItems.map((p) => (
                <ProjectListItem key={p.id} project={p} onClick={() => navigate(resourceUrl(narrow(scope, p.handler), 'overview'))} onSettings={() => navigate(editProjectUrl(scope.org, p.id))} onDelete={() => handleDeleteClick(p)} />
              ))}
            </Stack>
          )}
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[5, 10, 20, 50]}
            sx={{ mt: 2 }}
          />
        </>
      )}

      <Dialog open={deleteDialogOpen} onClose={handleCloseDialog}>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to delete the project "{projectToDelete?.name}"? This action cannot be undone and will remove all associated data.</DialogContentText>
          <DialogContentText sx={{ mt: 2, mb: 1 }}>
            Type <strong>{projectToDelete?.name}</strong> to confirm:
          </DialogContentText>
          <TextField
            fullWidth
            label="Confirm project name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={projectToDelete?.name}
            autoFocus
            helperText={`Type "${projectToDelete?.name}" to enable deletion`}
            disabled={deleteMutation.isPending}
          />
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button color="error" onClick={handleDeleteConfirm} disabled={confirmText !== projectToDelete?.name || deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Project'}
          </Button>
        </DialogActions>
      </Dialog>
    </PageContent>
  );
}
