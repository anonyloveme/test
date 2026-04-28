import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { trackNodeView } from '@services/supabase';
import type { LoadingState, TourManifest, TourNode } from '../types/tour';

interface TourStore {
  manifest: TourManifest | null;
  currentNode: TourNode | null;
  previousNode: TourNode | null;
  tourId: string | null;
  isMapVisible: boolean;
  isInfoVisible: boolean;
  isNodeListVisible: boolean;
  isTransitioning: boolean;
  loadingState: LoadingState;
  error: string | null;
  setManifest: (manifest: TourManifest, tourId: string) => void;
  navigateTo: (nodeId: string) => void;
  toggleMap: () => void;
  setMapVisible: (visible: boolean) => void;
  toggleInfo: () => void;
  setInfoVisible: (visible: boolean) => void;
  toggleNodeList: () => void;
  setNodeListVisible: (visible: boolean) => void;
  setError: (error: string | null) => void;
  setLoading: (state: LoadingState) => void;
}

export const useTourStore = create<TourStore>()(
  subscribeWithSelector((set, get) => ({
    manifest: null,
    currentNode: null,
    previousNode: null,
    tourId: null,
    isMapVisible: false,
    isInfoVisible: false,
    isNodeListVisible: false,
    isTransitioning: false,
    loadingState: 'idle',
    error: null,
    setManifest: (manifest, tourId) => {
      set({
        manifest,
        tourId,
        currentNode: manifest.nodes[0] ?? null,
        loadingState: 'success',
        error: null,
      });
    },
    navigateTo: (nodeId) => {
      const { manifest, currentNode, tourId } = get();
      if (!manifest) {
        return;
      }

      const target = manifest.nodes.find((node) => node.id === nodeId);
      if (!target || target.id === currentNode?.id) {
        return;
      }

      set({
        previousNode: currentNode,
        currentNode: target,
        isTransitioning: true,
        isInfoVisible: false,
      });

      if (tourId) {
        void trackNodeView(target.id, tourId);
      }

      setTimeout(() => set({ isTransitioning: false }), 1200);
    },
    toggleMap: () => set((state) => ({ isMapVisible: !state.isMapVisible })),
    setMapVisible: (visible) => set({ isMapVisible: visible }),
    toggleInfo: () => set((state) => ({ isInfoVisible: !state.isInfoVisible })),
    setInfoVisible: (visible) => set({ isInfoVisible: visible }),
    toggleNodeList: () => set((state) => ({ isNodeListVisible: !state.isNodeListVisible })),
    setNodeListVisible: (visible) => set({ isNodeListVisible: visible }),
    setError: (error) => set({ error, loadingState: 'error' }),
    setLoading: (loadingState) => set({ loadingState }),
  })),
);

export const useCurrentNode = () => useTourStore((state) => state.currentNode);
export const useManifest = () => useTourStore((state) => state.manifest);
export const useIsMapVisible = () => useTourStore((state) => state.isMapVisible);
export const useIsInfoVisible = () => useTourStore((state) => state.isInfoVisible);
export const useIsNodeListVisible = () => useTourStore((state) => state.isNodeListVisible);
export const useNavigateTo = () => useTourStore((state) => state.navigateTo);