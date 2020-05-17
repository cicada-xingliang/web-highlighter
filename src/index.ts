// import '@src/util/dataset.polyfill';
import EventEmitter from '@src/util/event.emitter';
import HighlightRange from '@src/model/range';
import HighlightSource from '@src/model/source';
import uuid from '@src/util/uuid';
import Hook from '@src/util/hook';
import getInteraction from '@src/util/interaction';
import Cache from '@src/data/cache';
import Painter from '@src/painter';
import {
    eventEmitter,
    getDefaultOptions,
    INTERNAL_ERROR_EVENT
} from '@src/util/const';
import {
    ERROR,
    DomNode,
    DomMeta,
    HookMap,
    EventType,
    CreateFrom,
    HighlighterOptions
} from './types';
import {
    addClass,
    removeClass,
    isHighlightWrapNode,
    getHighlightById,
    getHighlightsByRoot,
    getHighlightId,
    addEventListener,
    removeEventListener
} from '@src/util/dom';

export default class Highlighter extends EventEmitter {
    static event = EventType;
    static isHighlightSource = (d: any) => {
        return !!d.__isHighlightSource;
    }
    static isHighlightWrapNode = isHighlightWrapNode;

    private _hoverId: string;
    private event = getInteraction();
    options: HighlighterOptions;
    hooks: HookMap;
    painter: Painter;
    cache: Cache;

    constructor(options?: HighlighterOptions) {
        super();
        this.options = getDefaultOptions();
        this.hooks = this._getHooks(); // initialize hooks
        this.setOption(options);
        this.cache = new Cache(); // initialize cache
        const $root = this.options.$root;
        addEventListener($root, this.event.PointerOver, this._handleHighlightHover); // initialize event listener
        addEventListener($root, this.event.PointerTap, this._handleHighlightClick); // initialize event listener
        eventEmitter.on(INTERNAL_ERROR_EVENT, this._handleError);
    }

    private _getHooks = (): HookMap => ({
        Render: {
            UUID: new Hook('Render.UUID'),
            SelectedNodes: new Hook('Render.SelectedNodes'),
            WrapNode: new Hook('Render.WrapNode')
        },
        Serialize: {
            RecordInfo: new Hook('Serialize.RecordInfo')
        },
        Remove: {
            UpdateNodes: new Hook('Remove.UpdateNodes')
        }
    });

    private _highlightFromHRange = (range: HighlightRange): HighlightSource => {
        const source: HighlightSource = range.serialize(this.options.$root, this.hooks);
        const $wraps = this.painter.highlightRange(range);
        if ($wraps.length === 0) {
            eventEmitter.emit(INTERNAL_ERROR_EVENT, {
                type: ERROR.DOM_SELECTION_EMPTY
            });
            return null;
        }
        this.cache.save(source);
        this.emit(EventType.CREATE, {sources: [source], type: CreateFrom.INPUT}, this);
        return source;
    }

    private _highlightFromHSource(sources: HighlightSource[] | HighlightSource = []) {
        const renderedSources: Array<HighlightSource> = this.painter.highlightSource(sources);;
        this.emit(EventType.CREATE, {sources: renderedSources, type: CreateFrom.STORE}, this);
        this.cache.save(sources);
    }

    private _handleSelection = (e?: Event) => {
        const range = HighlightRange.fromSelection(this.hooks.Render.UUID);
        if (range) {
            this._highlightFromHRange(range);
            HighlightRange.removeDomRange();
        }
    }

    private _handleHighlightHover = e => {
        const $target = e.target as HTMLElement;
        if (!isHighlightWrapNode($target)) {
            this._hoverId && this.emit(EventType.HOVER_OUT, {id: this._hoverId}, this, e);
            this._hoverId = null;
            return;
        }

        const id = getHighlightId($target);
        // prevent trigger in the same highlight range
        if (this._hoverId === id) {
            return;
        }

        // hover another highlight range, need to trigger previous highlight hover out event
        if (this._hoverId) {
            this.emit(EventType.HOVER_OUT, {id: this._hoverId}, this, e);
        }
        this._hoverId = id;
        this.emit(EventType.HOVER, {id: this._hoverId}, this, e);
    }

    private _handleError = (type: string, detail?) => {
        if(this.options.verbose) {
            console.warn(type);
        }
    }

    private _handleHighlightClick = (e): void => {
        const $target = e.target as HTMLElement;
        if (isHighlightWrapNode($target)) {
            const id = getHighlightId($target);
            this.emit(EventType.CLICK, {id}, this, e);
        }
    }

    run = () => addEventListener(this.options.$root, this.event.PointerEnd, this._handleSelection);
    stop = () => removeEventListener(this.options.$root, this.event.PointerEnd, this._handleSelection);

    addClass = (className: string, id?: string) => this.getDoms(id).forEach($n => addClass($n, className));
    removeClass = (className: string, id?: string) => this.getDoms(id).forEach($n => removeClass($n, className));

    getIdByDom = ($node: HTMLElement): string => getHighlightId($node);
    getDoms = (id?: string): Array<HTMLElement> => id
        ? getHighlightById(this.options.$root, id, this.options.wrapTag)
        : getHighlightsByRoot(this.options.$root, this.options.wrapTag);

    dispose = () => {
        const $root = this.options.$root;
        removeEventListener($root, this.event.PointerOver, this._handleHighlightHover);
        removeEventListener($root, this.event.PointerEnd, this._handleSelection);
        removeEventListener($root, this.event.PointerTap, this._handleHighlightClick);
        this.removeAll();
    }

    setOption = (options?: HighlighterOptions) => {
        this.options = {
            ...this.options,
            ...options
        };
        this.painter = new Painter({
            $root: this.options.$root,
            wrapTag: this.options.wrapTag,
            className: this.options.style.className,
            exceptSelectors: this.options.exceptSelectors
        }, this.hooks);
    }

    fromRange = (range: Range): HighlightSource => {
        const start: DomNode = {
            $node: range.startContainer,
            offset: range.startOffset
        };
        const end: DomNode = {
            $node: range.endContainer,
            offset: range.endOffset
        }

        const text = range.toString();
        let id = this.hooks.Render.UUID.call(start, end, text);
        id = id !== undefined && id !== null ? id : uuid();
        const hRange = new HighlightRange(start, end, text, id);
        if (!hRange) {
            eventEmitter.emit(INTERNAL_ERROR_EVENT, {
                type: ERROR.RANGE_INVALID
            });
            return null;
        }
        return this._highlightFromHRange(hRange);
    }

    fromStore = (start: DomMeta, end: DomMeta, text, id): HighlightSource => {
        try {
            const hs = new HighlightSource(start, end, text, id);
            this._highlightFromHSource(hs);
            return hs;
        }
        catch (err) {
            eventEmitter.emit(INTERNAL_ERROR_EVENT, {
                type: ERROR.HIGHLIGHT_SOURCE_RECREATE,
                detail: { err, id, text, start, end }
            });
            return null;
        }
    }

    remove(id: string) {
        if (!id) {
            return;
        }
        const doseExist = this.painter.removeHighlight(id);
        this.cache.remove(id);
        // only emit REMOVE event when highlight exist
        if (doseExist) {
            this.emit(EventType.REMOVE, {ids: [id]}, this);
        }
    }

    removeAll() {
        this.painter.removeAllHighlight();
        const ids = this.cache.removeAll();
        this.emit(EventType.REMOVE, {ids: ids}, this);
    }
}
