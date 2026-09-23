import { useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { componentLibrary, componentOrder, categoryNames } from '../data/componentLibrary'
import { physicalAssetList, type ComponentPlacement } from '../data/physicalAssets'
import { renderSymbol } from '../lib/circuitRenderer'
import { useCircuitStore } from '../store/circuitStore'
import { IconButton } from './IconButton'

export function ComponentPalette({ onChoose, onClose }: { onChoose: (placement: ComponentPlacement) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const isReal = useCircuitStore(state => state.viewMode === 'real')
  const matches = componentOrder.filter(type => `${componentLibrary[type].name} ${componentLibrary[type].nameEn}`.toLowerCase().includes(query.trim().toLowerCase()))
  const assetMatches = physicalAssetList.filter(asset => `${asset.name} ${componentLibrary[asset.type].nameEn}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <aside className="component-palette" aria-label="元件库">
    <div className="section-heading"><span>{isReal ? '实物素材库' : '元件库'}</span><span className="count-badge">{isReal ? physicalAssetList.length : componentOrder.length}</span><IconButton label="关闭元件库" className="mobile-only" onClick={onClose}><X size={16} /></IconButton></div>
    <div className="palette-search"><Search size={15} /><input aria-label="搜索元件" placeholder="搜索元件" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="palette-content">
      {['source', 'control', 'load', 'measure'].map(category => {
        const types = matches.filter(type => componentLibrary[type].category === category)
        const assets = assetMatches.filter(asset => componentLibrary[asset.type].category === category)
        if (isReal) return assets.length ? <section key={category} className="palette-group">
          <h2>{categoryNames[category]}</h2>
          {assets.map(asset => <button key={asset.id} type="button" className="palette-item physical-palette-item" draggable data-testid={`palette-asset-${asset.id}`} title={`放置${asset.name}`}
            onDragStart={event => { event.dataTransfer.setData('componentType', asset.type); event.dataTransfer.setData('componentAssetId', asset.id); event.dataTransfer.effectAllowed = 'copy' }}
            onClick={() => onChoose({ type: asset.type, assetId: asset.id })}>
            <span className="physical-thumbnail"><img src={asset.src} alt={asset.name} draggable={false} width={52} height={46} /></span>
            <span className="physical-palette-name">{asset.name}</span><Plus size={12} className="palette-add" />
          </button>)}
        </section> : null
        return types.length ? <section key={category} className="palette-group">
          <h2>{categoryNames[category]}</h2>
          {types.map(type => <button key={type} type="button" className="palette-item" draggable data-testid={`palette-${type}`} title={`放置${componentLibrary[type].name}`}
            onDragStart={event => { event.dataTransfer.setData('componentType', type); event.dataTransfer.effectAllowed = 'copy' }}
            onClick={() => onChoose({ type })}>
            <svg viewBox="-60 -42 120 84" width="44" height="36" aria-hidden="true"><g dangerouslySetInnerHTML={{ __html: renderSymbol(type, false) }} /></svg>
            <span>{componentLibrary[type].name}</span><Plus size={12} className="palette-add" />
          </button>)}
        </section> : null
      })}
      {!(isReal ? assetMatches.length : matches.length) && <p className="empty-search">无匹配元件</p>}
    </div>
    <div className="palette-footer"><span className="status-dot" />{isReal ? '实物素材库' : '标准符号库'}<span>{isReal ? `${physicalAssetList.length} PNG` : 'v0.1'}</span></div>
  </aside>
}
