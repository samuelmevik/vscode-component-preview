import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  useLazyGetRandomCatQuery,
  setSelectedTag,
  setSaysText,
  toggleFavorite,
  removeFavorite,
  clearFavorites,
} from './catStore';
import type { CatItem, FavoriteCat, RootState } from './catStore';
import styles from './CatGallery.module.scss';

export type { CatItem, FavoriteCat };

export interface CatImageCardProps {
  cat: CatItem | null;
  isLoading: boolean;
  isFavorite: boolean;
  onToggleFavorite?: () => void;
}

/**
 * Small Component 1: CatImageCard
 * Displays the fetched Cat image, tags, skeleton loader, and like/favorite action.
 */
/* @preview: Cat Image Card (Active)
props:
  cat:
    id: "SW2Cs8h9cHWMmyTu"
    url: "https://cataas.com/cat/SW2Cs8h9cHWMmyTu"
    tags: ["cute", "orange", "fluffy", "sleepy"]
  isLoading: false
  isFavorite: true
*/
export const CatImageCard: React.FC<CatImageCardProps> = ({
  cat,
  isLoading,
  isFavorite,
  onToggleFavorite,
}) => {
  return (
    <div className={styles.card}>
      <div className={styles.imageWrapper}>
        {isLoading ? (
          <div className={styles.placeholder}>
            <div className={styles.spinner}></div>
            <span>Fetching cat via RTK Query...</span>
          </div>
        ) : cat?.url ? (
          <img
            src={cat.url}
            alt={cat.tags?.join(', ') || 'Cat'}
            onError={(e) => {
              (e.target as HTMLImageElement).src = `https://cataas.com/cat/${cat.id}`;
            }}
          />
        ) : (
          <div className={styles.placeholder}>
            <span>No cat loaded. Click Fetch!</span>
          </div>
        )}
      </div>

      <div className={styles.cardMeta}>
        {cat?.tags && cat.tags.length > 0 && (
          <div className={styles.tags}>
            {cat.tags.slice(0, 5).map((t) => (
              <span key={t} className={styles.tag}>
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className={styles.cardFooter}>
          <span className={styles.catId}>ID: {cat?.id ? cat.id.slice(0, 8) + '...' : 'none'}</span>
          <div className={styles.cardActions}>
            <button
              className={`${styles.favoriteBtn} ${isFavorite ? styles.active : ''}`}
              onClick={onToggleFavorite}
              title={isFavorite ? 'Remove from Redux favorites' : 'Save to Redux favorites'}
            >
              {isFavorite ? '❤️ Liked' : '🤍 Like'}
            </button>
            {cat?.url && (
              <a href={cat.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                <button title="Open full resolution in new tab">↗ View</button>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export interface CatTagSelectorProps {
  tags: string[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

/**
 * Small Component 2: CatTagSelector
 * Filter tag selector pill buttons.
 */
/* @preview: Tag Selector
props:
  tags: ["cute", "orange", "gif", "sleepy", "small", "funny"]
  selectedTag: "orange"
*/
export const CatTagSelector: React.FC<CatTagSelectorProps> = ({
  tags,
  selectedTag,
  onSelectTag,
}) => {
  return (
    <div className={styles.tagSelector}>
      <span className={styles.tagLabel}>Filter by Tag</span>
      <div className={styles.tagList}>
        <button
          className={`${styles.tagPill} ${selectedTag === null ? styles.active : ''}`}
          onClick={() => onSelectTag(null)}
        >
          All Cats
        </button>
        {tags.map((t) => (
          <button
            key={t}
            className={`${styles.tagPill} ${selectedTag === t ? styles.active : ''}`}
            onClick={() => onSelectTag(selectedTag === t ? null : t)}
          >
            #{t}
          </button>
        ))}
      </div>
    </div>
  );
};

export interface CatSaysInputProps {
  value: string;
  onChange: (val: string) => void;
  onFetch: () => void;
}

const CAT_PRESETS = ['Meow!', 'Need Coffee ☕', 'Debugging... 🐛', 'LGTM 🐾'];
const POPULAR_TAGS = ['cute', 'orange', 'gif', 'sleepy', 'small', 'funny'];

/**
 * Small Component 3: CatSaysInput
 * Text overlay input to make the cat say custom text.
 */
/* @preview: Cat Says Input
props:
  value: "I love RTK Query & Redux"
*/
export const CatSaysInput: React.FC<CatSaysInputProps> = ({
  value,
  onChange,
  onFetch,
}) => {
  return (
    <div className={styles.saysInputGroup}>
      <span className={styles.inputLabel}>Cat Says Overlay</span>
      <div className={styles.inputWrapper}>
        <input
          type="text"
          placeholder="Make cat say something..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onFetch()}
        />
      </div>
      <div className={styles.presetChips}>
        {CAT_PRESETS.map((p) => (
          <button key={p} className={styles.chip} onClick={() => onChange(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
};

export interface CatFavoritesDrawerProps {
  favorites: FavoriteCat[];
  onRemoveFavorite: (id: string) => void;
  onClearAll: () => void;
  onSelectFavorite?: (cat: FavoriteCat) => void;
}

/**
 * Small Component 4: CatFavoritesDrawer
 * Displays the list of cats stored in the Redux `catGallery.favorites` slice.
 */
/* @preview: Favorites Drawer (Populated)
props:
  favorites:
    - id: "SW2Cs8h9cHWMmyTu"
      url: "https://cataas.com/cat/SW2Cs8h9cHWMmyTu"
      tags: ["cute", "orange"]
      likedAt: "10:14 AM"
    - id: "4y6Hyu0uzVZcEx89"
      url: "https://cataas.com/cat/4y6Hyu0uzVZcEx89"
      tags: ["tabby"]
      likedAt: "10:18 AM"
*/
export const CatFavoritesDrawer: React.FC<CatFavoritesDrawerProps> = ({
  favorites,
  onRemoveFavorite,
  onClearAll,
  onSelectFavorite,
}) => {
  return (
    <div className={styles.favoritesDrawer}>
      <div className={styles.drawerHeader}>
        <div className={styles.drawerTitle}>
          <span>❤️ Favorites ({favorites.length})</span>
        </div>
        {favorites.length > 0 && (
          <button className={styles.clearBtn} onClick={onClearAll} title="Clear all favorites">
            Clear All
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className={styles.drawerEmpty}>
          No favorites saved yet. Click "Like" to store cats in Redux!
        </div>
      ) : (
        <div className={styles.drawerList}>
          {favorites.map((fav) => (
            <div
              key={fav.id}
              className={styles.drawerItem}
              title={`ID: ${fav.id}\nLiked at: ${fav.likedAt}`}
              onClick={() => onSelectFavorite?.(fav)}
            >
              <img src={fav.url} alt={`Cat ${fav.id}`} />
              <button
                className={styles.removeBtn}
                title="Remove from favorites"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFavorite(fav.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export interface CatStatsBarProps {
  requestCount: number;
  favoriteCount: number;
  isFetching: boolean;
  statusText?: string;
}

/**
 * Small Component 5: CatStatsBar
 * Diagnostic summary showing Redux request count, favorites, and RTK Query status.
 */
/* @preview: Stats Bar (Active)
props:
  requestCount: 8
  favoriteCount: 3
  isFetching: false
  statusText: "RTK Query Ready"
*/
export const CatStatsBar: React.FC<CatStatsBarProps> = ({
  requestCount,
  favoriteCount,
  isFetching,
  statusText,
}) => {
  return (
    <div className={styles.statsBar}>
      <div className={styles.stat}>
        <span>Requests:</span>
        <strong>{requestCount}</strong>
      </div>
      <div className={styles.stat}>
        <span>Favorites:</span>
        <strong>{favoriteCount}</strong>
      </div>
      <div className={styles.stat}>
        <span>Status:</span>
        <strong>{isFetching ? 'Fetching ⏳' : statusText || 'Cached / Ready'}</strong>
      </div>
    </div>
  );
};

export interface CatGalleryProps {
  title?: string;
}

/**
 * Main Composite Component: CatGallery
 * Incorporates a real Redux store with RTK Query (createApi) from cataas.com.
 *
 * Demonstrates:
 * 1. RTK Query API: Live HTTP requests intercepted and logged in the HTTP tab.
 * 2. Redux Slice State: Action dispatches logged in the Redux tab.
 * 3. Comment-based Mock Data: storePath + preloaded Redux state variants.
 * 4. Multi-Component Selection: Every subcomponent can be previewed independently.
 * 5. Device Viewport Frames: Mobile responsive testing.
 */
/* @preview: RTK Query Live Explorer
storePath: "./catStore"
props:
  title: "CATAAS RTK Query Explorer"
*/
/* @preview: Preloaded Redux State
storePath: "./catStore"
store:
  catGallery:
    selectedTag: "cute"
    saysText: "Redux Toolkit is Awesome!"
    requestCount: 9
    favorites:
      - id: "SW2Cs8h9cHWMmyTu"
        url: "https://cataas.com/cat/SW2Cs8h9cHWMmyTu"
        tags: ["cute", "orange", "fluffy"]
        likedAt: "10:30 AM"
      - id: "4y6Hyu0uzVZcEx89"
        url: "https://cataas.com/cat/4y6Hyu0uzVZcEx89"
        tags: ["tabby"]
        likedAt: "10:35 AM"
props:
  title: "Preloaded Redux State"
*/
/* @preview: Orange Cats Filtered
storePath: "./catStore"
store:
  catGallery:
    selectedTag: "orange"
    saysText: ""
    requestCount: 4
    favorites: []
props:
  title: "Orange Cats Filtered"
*/
/* @preview: Mobile Device Frame
storePath: "./catStore"
viewport:
  width: 375
  height: 667
store:
  catGallery:
    selectedTag: null
    saysText: "Mobile RTK Query 🐾"
    requestCount: 2
    favorites:
      - id: "98qvAp6CYXZMLztN"
        url: "https://cataas.com/cat/98qvAp6CYXZMLztN"
        tags: ["kitten", "small"]
        likedAt: "11:00 AM"
props:
  title: "Mobile View"
*/
export const CatGallery: React.FC<CatGalleryProps> = ({
  title = 'Cat-as-a-Service (RTK Query)',
}) => {
  const dispatch = useDispatch();
  const [selectedFavorite, setSelectedFavorite] = useState<CatItem | null>(null);

  // Safely read Redux state from catGallery slice
  const galleryState = useSelector((state: RootState) => state?.catGallery) || {
    selectedTag: null,
    saysText: '',
    favorites: [],
    requestCount: 0,
  };

  const { selectedTag, saysText, favorites, requestCount } = galleryState;

  // RTK Query hook for fetching cats from cataas.com
  const [triggerGetCat, { data: catData, isFetching, isLoading, isError }] =
    useLazyGetRandomCatQuery();

  // Active cat to display: selected from drawer, live RTK Query data, or first preloaded favorite
  const currentCat: CatItem | null =
    selectedFavorite ||
    catData ||
    (favorites && favorites.length > 0
      ? {
          id: favorites[0].id,
          url: favorites[0].url,
          tags: favorites[0].tags,
        }
      : null);

  const handleFetchCat = useCallback(
    (tag: string | null = selectedTag, text: string = saysText) => {
      setSelectedFavorite(null);
      triggerGetCat({ tag, says: text, timestamp: Date.now() });
    },
    [triggerGetCat, selectedTag, saysText]
  );

  // Initial fetch on component mount
  useEffect(() => {
    handleFetchCat(selectedTag, saysText);
  }, []);

  const handleTagChange = useCallback(
    (newTag: string | null) => {
      dispatch(setSelectedTag(newTag));
      handleFetchCat(newTag, saysText);
    },
    [dispatch, handleFetchCat, saysText]
  );

  const handleToggleFavorite = useCallback(() => {
    if (!currentCat?.id) return;
    dispatch(
      toggleFavorite({
        id: currentCat.id,
        url: currentCat.url,
        tags: currentCat.tags,
      })
    );
  }, [dispatch, currentCat]);

  const isFavorite = currentCat?.id
    ? favorites?.some((f) => f.id === currentCat.id)
    : false;

  return (
    <div className={styles.container}>
      {/* Header with Title and RTK Badge */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.icon}>🐱</span>
          <h2>{title}</h2>
          <span className={styles.rtkBadge}>RTK Query</span>
        </div>
        <a
          href="https://cataas.com"
          target="_blank"
          rel="noreferrer"
          className={styles.apiUrl}
          title="Cat-as-a-Service official site"
        >
          cataas.com ↗
        </a>
      </div>

      {/* Error Banner */}
      {isError && (
        <div className={styles.errorBanner}>
          <span>Failed to fetch cat from cataas.com</span>
          <button onClick={() => handleFetchCat(selectedTag, saysText)}>Retry</button>
        </div>
      )}

      {/* Small Component 1: Image Card */}
      <CatImageCard
        cat={currentCat}
        isLoading={isLoading || isFetching}
        isFavorite={Boolean(isFavorite)}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* Small Component 2: Tag Selector */}
      <CatTagSelector
        tags={POPULAR_TAGS}
        selectedTag={selectedTag}
        onSelectTag={handleTagChange}
      />

      {/* Small Component 3: Says Text Overlay */}
      <CatSaysInput
        value={saysText}
        onChange={(val) => dispatch(setSaysText(val))}
        onFetch={() => handleFetchCat(selectedTag, saysText)}
      />

      {/* Action Button: Triggers RTK Query */}
      <div className={styles.controls}>
        <button
          className={styles.fetchBtn}
          disabled={isLoading || isFetching}
          onClick={() => handleFetchCat(selectedTag, saysText)}
        >
          {isFetching ? 'Fetching via RTK Query...' : '🎲 Fetch New Cat (RTK Query)'}
        </button>
      </div>

      {/* Small Component 4: Favorites Drawer (Redux Slice state) */}
      <CatFavoritesDrawer
        favorites={favorites || []}
        onRemoveFavorite={(id) => {
          if (selectedFavorite?.id === id) {
            setSelectedFavorite(null);
          }
          dispatch(removeFavorite(id));
        }}
        onClearAll={() => {
          setSelectedFavorite(null);
          dispatch(clearFavorites());
        }}
        onSelectFavorite={(fav) => {
          setSelectedFavorite({
            id: fav.id,
            url: fav.url,
            tags: fav.tags,
          });
        }}
      />

      {/* Small Component 5: Stats Bar (Redux + RTK Query stats) */}
      <CatStatsBar
        requestCount={requestCount || 0}
        favoriteCount={favorites?.length || 0}
        isFetching={isFetching}
        statusText={currentCat?.id ? `ID: ${currentCat.id.slice(0, 6)}...` : undefined}
      />
    </div>
  );
};

export default CatGallery;
