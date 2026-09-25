import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export interface CatItem {
  id: string;
  url: string;
  tags?: string[];
  created_at?: string;
  mimetype?: string;
}

export interface CatQueryArgs {
  tag?: string | null;
  says?: string;
  timestamp?: number;
}

export interface FavoriteCat {
  id: string;
  url: string;
  tags: string[];
  likedAt: string;
}

export interface CatGalleryState {
  selectedTag: string | null;
  saysText: string;
  favorites: FavoriteCat[];
  requestCount: number;
}

/**
 * RTK Query API for cataas.com (Cat-as-a-Service).
 * All HTTP requests made through this API are automatically intercepted
 * and logged in the Component Preview Network / HTTP Inspector!
 */
export const catApi = createApi({
  reducerPath: 'catApi',
  baseQuery: fetchBaseQuery({
    baseUrl: 'https://cataas.com/',
  }),
  tagTypes: ['Cat'],
  endpoints: (builder) => ({
    getRandomCat: builder.query<CatItem, CatQueryArgs | void>({
      query: (args) => {
        const tag = args?.tag?.trim();
        const says = args?.says?.trim();

        let path = 'cat';
        if (says) {
          path += `/says/${encodeURIComponent(says)}`;
        }

        const params = new URLSearchParams({ json: 'true' });
        if (tag) {
          params.append('tag', tag);
        }

        return `${path}?${params.toString()}`;
      },
      transformResponse: (res: any) => {
        return {
          id: res.id,
          url: res.url || `https://cataas.com/cat/${res.id}`,
          tags: Array.isArray(res.tags) ? res.tags : [],
          created_at: res.created_at,
          mimetype: res.mimetype,
        };
      },
      providesTags: ['Cat'],
    }),
  }),
});

export const { useGetRandomCatQuery, useLazyGetRandomCatQuery } = catApi;

const initialGalleryState: CatGalleryState = {
  selectedTag: null,
  saysText: '',
  favorites: [],
  requestCount: 0,
};

export const catGallerySlice = createSlice({
  name: 'catGallery',
  initialState: initialGalleryState,
  reducers: {
    setSelectedTag: (state, action: PayloadAction<string | null>) => {
      console.log('[catGallerySlice] Setting selected tag:', action.payload);
      state.selectedTag = action.payload;
    },
    setSaysText: (state, action: PayloadAction<string>) => {
      state.saysText = action.payload;
    },
    toggleFavorite: (
      state,
      action: PayloadAction<{ id: string; url: string; tags?: string[] }>
    ) => {
      const cat = action.payload;
      const index = state.favorites.findIndex((f) => f.id === cat.id);
      if (index >= 0) {
        console.log('[catGallerySlice] Removing cat from favorites:', cat.id);
        state.favorites.splice(index, 1);
      } else {
        console.log('[catGallerySlice] Adding cat to favorites:', cat.id);
        state.favorites.push({
          id: cat.id,
          url: cat.url,
          tags: cat.tags || [],
          likedAt: new Date().toLocaleTimeString(),
        });
      }
    },
    removeFavorite: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.favorites = state.favorites.filter((f) => f.id !== id);
    },
    clearFavorites: (state) => {
      console.log('[catGallerySlice] Clearing all favorites');
      state.favorites = [];
    },
    incrementRequestCount: (state) => {
      state.requestCount += 1;
    },
  },
  extraReducers: (builder) => {
    // Automatically increment request count whenever RTK Query finishes a request
    builder.addMatcher(catApi.endpoints.getRandomCat.matchFulfilled, (state) => {
      state.requestCount += 1;
    });
  },
});

export const {
  setSelectedTag,
  setSaysText,
  toggleFavorite,
  removeFavorite,
  clearFavorites,
  incrementRequestCount,
} = catGallerySlice.actions;

export interface RootState {
  [catApi.reducerPath]: ReturnType<typeof catApi.reducer>;
  catGallery: CatGalleryState;
}

/**
 * Store factory function:
 * Used by Component Preview when instantiated with comment-based mock state overrides.
 */
export const setupStore = (preloadedState?: Partial<RootState>) => {
  return configureStore({
    reducer: {
      [catApi.reducerPath]: catApi.reducer,
      catGallery: catGallerySlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(catApi.middleware),
    preloadedState: preloadedState as any,
  });
};

export const store = setupStore();
export default store;
