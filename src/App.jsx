import { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Line, Group, Text, Arrow, Transformer, RegularPolygon, Star } from 'react-konva';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import './index.css';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider('ws://localhost:1234', 'whiteboard-room-1', ydoc);
const awareness = provider.awareness;
const yShapes = ydoc.getMap('shapes');
const yLog = ydoc.getArray('log');

const USER_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
const PALETTE = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#18181b', '#f9fafb'];

const currentUser = {
  name: `User-${Math.floor(Math.random() * 900 + 100)}`,
  color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
};
awareness.setLocalStateField('user', currentUser);

const SCALE_BY = 1.1;
const ACTIVITY_WIDTH = 280;
const TOOLS_WIDTH = 200;
const TOTAL_SIDEBAR_WIDTH = ACTIVITY_WIDTH + TOOLS_WIDTH;

function throttle(func, limit) {
  let inThrottle = false;
  let lastArgs = null;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) { func.apply(this, lastArgs); lastArgs = null; }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}

export default function App() {
  const stageRef = useRef(null);
  const layerRef = useRef(null);
  const trRef = useRef(null);

  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const [stageDimensions, setStageDimensions] = useState({ width: window.innerWidth - TOTAL_SIDEBAR_WIDTH, height: window.innerHeight });

  const [shapes, setShapes] = useState([]);
  const [cursors, setCursors] = useState([]);
  const [logs, setLogs] = useState([]);
  
  const [tool, setTool] = useState('cursor');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [hoveredLog, setHoveredLog] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [activeColor, setActiveColor] = useState(currentUser.color);

  const isDrawing = useRef(false);
  const [currentLine, setCurrentLine] = useState(null);

  const handleToolChange = (newTool) => {
    setTool(newTool);
    if (newTool !== 'cursor') {
      setSelectedIds([]);
      setSelectionBox(null);
    }
  };

  useEffect(() => {
    const handleResize = () => setStageDimensions({ width: window.innerWidth - TOTAL_SIDEBAR_WIDTH, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getCanvasCoordinates = (screenX, screenY) => ({
    x: (screenX - stagePos.x) / stageScale,
    y: (screenY - stagePos.y) / stageScale,
  });

  useEffect(() => {
    const syncShapes = () => setShapes(Array.from(yShapes.values()));
    const syncLogs = () => setLogs(yLog.toArray());
    const syncAwareness = () => {
      const states = awareness.getStates();
      const currentClientId = awareness.clientID;
      const remoteCursors = [];
      states.forEach((state, id) => {
        if (
          id !== currentClientId && 
          state.cursor && 
          state.user && 
          state.user.name !== currentUser.name
        ) {
          remoteCursors.push({ clientID: id, cursor: state.cursor, user: state.user });
        }
      });
      setCursors(remoteCursors);
    };

    yShapes.observe(syncShapes);
    yLog.observe(syncLogs);
    awareness.on('change', syncAwareness);
    syncShapes(); syncLogs(); syncAwareness();

    return () => {
      yShapes.unobserve(syncShapes);
      yLog.unobserve(syncLogs);
      awareness.off('change', syncAwareness);
    };
  }, []);

  useEffect(() => {
    if (trRef.current && layerRef.current) {
      if (tool !== 'cursor') { trRef.current.nodes([]); return; }
      const nodes = selectedIds.map((id) => layerRef.current.findOne('#' + id)).filter(Boolean);
      trRef.current.nodes(nodes);
      trRef.current.getLayer().batchDraw();
    }
  }, [selectedIds, tool, shapes]);

  const pushActivityLog = (action, targetName, shapeId = null) => {
    yLog.push([{ 
      user: currentUser.name, 
      color: currentUser.color, 
      action, 
      target: targetName, 
      shapeId, 
      time: Date.now() 
    }]);
  };

  const handleColorChange = (color) => {
    setActiveColor(color);
    if (tool === 'cursor' && selectedIds.length > 0) {
      selectedIds.forEach((id) => {
        const shape = yShapes.get(id);
        if (shape) { 
          yShapes.set(id, { ...shape, fill: color }); 
          pushActivityLog('recolored', shape.type, id); 
        }
      });
    }
  };

  const handlePointerDown = (e) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const pos = getCanvasCoordinates(pointer.x, pointer.y);
    
    const clickedOnEmpty = e.target === e.target.getStage();

    if (tool === 'pencil') {
      isDrawing.current = true;
      setCurrentLine({ id: Date.now().toString(), type: 'line', points: [pos.x, pos.y], fill: activeColor });
      return;
    }

    if (tool === 'cursor') {
      if (clickedOnEmpty) {
        setSelectedIds([]);
        setSelectionBox({ startX: pos.x, startY: pos.y, width: 0, height: 0, visible: true });
      } else {
        const id = e.target.id();
        if (id && !selectedIds.includes(id)) setSelectedIds([id]);
      }
    }
  };

  const handlePointerMove = (e) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (pointer) {
      const world = getCanvasCoordinates(pointer.x, pointer.y);
      awareness.setLocalStateField('cursor', { x: world.x, y: world.y });

      if (tool === 'pencil' && isDrawing.current && currentLine) {
        setCurrentLine({ ...currentLine, points: [...currentLine.points, world.x, world.y] });
      }
      if (tool === 'cursor' && selectionBox?.visible) {
        setSelectionBox((prev) => ({ ...prev, width: world.x - prev.startX, height: world.y - prev.startY }));
      }
    }
  };

  const handlePointerUp = (e) => {
    if (tool === 'pencil' && isDrawing.current && currentLine) {
      isDrawing.current = false;
      yShapes.set(currentLine.id, currentLine); 
      pushActivityLog('drew', 'a stroke', currentLine.id);
      setCurrentLine(null);
    }

    if (tool === 'cursor' && selectionBox?.visible) {
      if (Math.abs(selectionBox.width) > 5 && Math.abs(selectionBox.height) > 5) {
        const box = {
          x: Math.min(selectionBox.startX, selectionBox.startX + selectionBox.width),
          y: Math.min(selectionBox.startY, selectionBox.startY + selectionBox.height),
          width: Math.abs(selectionBox.width),
          height: Math.abs(selectionBox.height),
        };
        const newSelected = [];
        layerRef.current.find('.shape').forEach((shapeNode) => {
          const shapeBox = shapeNode.getClientRect({ relativeTo: layerRef.current });
          const intersect = !(box.x > shapeBox.x + shapeBox.width || box.x + box.width < shapeBox.x || box.y > shapeBox.y + shapeBox.height || box.y + box.height < shapeBox.y);
          if (intersect) newSelected.push(shapeNode.id());
        });
        setSelectedIds(newSelected);
      }
      setSelectionBox(null);
    }
  };

  const handlePointerLeave = () => awareness.setLocalStateField('cursor', null);

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * SCALE_BY : oldScale / SCALE_BY;
    setStageScale(newScale);
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  };

  const getCenterCanvasCoordinates = () => ({
    x: (stageDimensions.width / 2 - stagePos.x) / stageScale,
    y: (stageDimensions.height / 2 - stagePos.y) / stageScale,
  });

  const addShape = (type, extraProps = {}) => {
    const center = getCenterCanvasCoordinates();
    const id = Date.now().toString();
    yShapes.set(id, { id, type, x: center.x, y: center.y, fill: activeColor, ...extraProps });
    pushActivityLog('added', type, id);
  };

  const handleDeleteShape = (id, type) => {
    if (tool !== 'cursor') return;
    yShapes.delete(id);
    setSelectedIds((prev) => prev.filter((sId) => sId !== id));
    pushActivityLog('deleted', type, id);
  };

  const deleteSelected = () => {
    if (selectedIds.length === 0) return;
    selectedIds.forEach((id) => {
      const shape = yShapes.get(id);
      if (shape) { yShapes.delete(id); pushActivityLog('deleted', shape.type, id); }
    });
    setSelectedIds([]);
  };

  const throttledUpdateCRDT = useRef(throttle((id, updates) => {
    const shape = yShapes.get(id);
    if (shape) yShapes.set(id, { ...shape, ...updates });
  }, 40)).current;

  const handleTransformEnd = (e) => {
    trRef.current.nodes().forEach((node) => {
      const id = node.id();
      const shape = yShapes.get(id);
      if (shape) yShapes.set(id, { ...shape, x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
    });
    pushActivityLog('modified', 'selection');
  };

  const renderShape = (shape) => {
    const isDraggable = tool === 'cursor' && selectedIds.includes(shape.id);
    const isHoveredInLog = hoveredLog && hoveredLog.shapeId === shape.id;

    const commonProps = {
      id: shape.id, name: 'shape', x: shape.x, y: shape.y,
      scaleX: shape.scaleX || 1, scaleY: shape.scaleY || 1, rotation: shape.rotation || 0,
      fill: shape.fill, draggable: isDraggable,
      
      stroke: isHoveredInLog ? '#3b82f6' : null,
      strokeWidth: isHoveredInLog ? 4 / stageScale : 0,
      shadowColor: isHoveredInLog ? '#3b82f6' : null,
      shadowBlur: isHoveredInLog ? 10 : 0,
      
      onDragMove: (e) => throttledUpdateCRDT(shape.id, { x: e.target.x(), y: e.target.y() }),
      onDragEnd: (e) => { throttledUpdateCRDT(shape.id, { x: e.target.x(), y: e.target.y() }); pushActivityLog('moved', shape.type, shape.id); },
      onDblClick: () => handleDeleteShape(shape.id, shape.type)
    };

    if (shape.type === 'rect') return <Rect key={shape.id} {...commonProps} x={shape.x - 50} y={shape.y - 50} width={100} height={100} />;
    if (shape.type === 'circle') return <Circle key={shape.id} {...commonProps} radius={50} />;
    if (shape.type === 'triangle') return <RegularPolygon key={shape.id} {...commonProps} sides={3} radius={55} />;
    if (shape.type === 'star') return <Star key={shape.id} {...commonProps} numPoints={5} innerRadius={25} outerRadius={50} />;
    if (shape.type === 'line') return <Line key={shape.id} {...commonProps} points={shape.points} stroke={shape.fill} strokeWidth={6} tension={0.5} lineCap="round" lineJoin="round" fill={null} />;
    return null;
  };

  return (
    <div className="app-container">
      
      <div className="sidebar" style={{ width: ACTIVITY_WIDTH, minWidth: ACTIVITY_WIDTH }}>
        <h2 className="sidebar-header">Activity Log</h2>
        <div className="log-container">
          {logs.slice().reverse().map((log, i) => (
            <div 
              key={i} 
              className="log-entry"
              onMouseEnter={(e) => {
                setHoveredLog(log);
                setHoverPos({ x: e.clientX + 20, y: e.clientY });
              }}
              onMouseMove={(e) => {
                setHoverPos({ x: e.clientX + 20, y: e.clientY });
              }}
              onMouseLeave={() => setHoveredLog(null)}
            >
              <div className="log-user">
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: log.color }} />
                <span>{log.user}</span>
              </div>
              <div className="log-action">
                {log.action} {log.target}
                <span className="log-time">{new Date(log.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </div>
            </div>
          ))}
          {logs.length === 0 && <div>No activity yet.</div>}
        </div>
      </div>

      <div className="sidebar" style={{ width: TOOLS_WIDTH, minWidth: TOOLS_WIDTH, padding: '20px' }}>
        
        <h3 className="tools-section-title">Colors</h3>
        <div className="palette">
          {PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => handleColorChange(color)}
              className="color-swatch"
              style={{
                backgroundColor: color,
                border: activeColor === color ? '3px solid #fff' : `1px solid ${color === '#18181b' ? '#3f3f46' : 'transparent'}`,
                outline: activeColor === color ? '2px solid #3b82f6' : 'none'
              }}
            />
          ))}
        </div>
        <hr style={{ width: '100%', borderColor: '#27272a', margin: '8px 0 16px' }} />

        <h3 className="tools-section-title">Shapes</h3>
        <button onClick={() => addShape('rect')} className="btn-sidebar">+ Rectangle 🟨</button>
        <button onClick={() => addShape('circle')} className="btn-sidebar">+ Circle 🔴</button>
        <button onClick={() => addShape('triangle')} className="btn-sidebar">+ Triangle 🔺</button>
        <button onClick={() => addShape('star')} className="btn-sidebar">+ Star ⭐</button>
        
        <hr style={{ width: '100%', borderColor: '#27272a', margin: '8px 0 16px' }} />
        
        <button onClick={deleteSelected} disabled={selectedIds.length === 0} className={`btn-sidebar btn-delete ${selectedIds.length > 0 ? 'active' : ''}`}>
          🗑️ Delete Selected
        </button>

        <div className="user-badge">
          <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: currentUser.color }} />
          You: <strong>{currentUser.name}</strong>
        </div>
      </div>

      <div 
        className={`canvas-wrapper ${isDarkMode ? 'dark' : 'light'}`}
        style={{
          backgroundPosition: '0px 0px',
          backgroundSize: '24px 24px'
        }}
      >
        <div className="floating-toolbar">
          <button onClick={() => handleToolChange('cursor')} className={`btn-tool ${tool === 'cursor' ? 'active' : ''}`}>↖️ Select</button>
          <button onClick={() => handleToolChange('pan')} className={`btn-tool ${tool === 'pan' ? 'active' : ''}`}>✋ Pan</button>
          <button onClick={() => handleToolChange('pencil')} className={`btn-tool ${tool === 'pencil' ? 'active' : ''}`}>✏️ Pencil</button>
        </div>

        <button 
          className="theme-toggle-btn"
          onClick={() => setIsDarkMode(!isDarkMode)}
          title="Toggle Dark Mode"
        >
          {isDarkMode ? '☀️' : '🌙'}
        </button>

        <Stage
          ref={stageRef} width={stageDimensions.width} height={stageDimensions.height} draggable={tool === 'pan'}
          x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}
          onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp} onMouseLeave={handlePointerLeave}
          onDragEnd={(e) => { if (e.target === e.target.getStage() && tool === 'pan') setStagePos({ x: e.target.x(), y: e.target.y() }); }}
        >
          <Layer ref={layerRef}>
            {shapes.map(renderShape)}
            {currentLine && <Line points={currentLine.points} stroke={currentLine.fill} strokeWidth={6} tension={0.5} lineCap="round" lineJoin="round" />}
            {selectionBox?.visible && <Rect x={selectionBox.startX} y={selectionBox.startY} width={selectionBox.width} height={selectionBox.height} fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth={1 / stageScale} />}
            <Transformer ref={trRef} onTransformEnd={handleTransformEnd} />
          </Layer>
          <Layer listening={false}>
            {cursors.map(({ clientID, cursor, user }) => (
              <Group key={clientID} x={cursor.x} y={cursor.y}>
                <Arrow points={[0, 0, 14, 14]} pointerLength={8} pointerWidth={8} fill={user.color} stroke={user.color} strokeWidth={2} />
                <Rect x={16} y={16} width={user.name.length * 8 + 14} height={20} fill={user.color} cornerRadius={4} />
                <Text x={22} y={20} text={user.name} fontSize={11} fill="#ffffff" fontStyle="bold" />
              </Group>
            ))}
          </Layer>
        </Stage>
      </div>

      {/* Global Floating Popup */}
      {hoveredLog && (
        <div 
          className="log-preview-window" 
          style={{ left: hoverPos.x, top: hoverPos.y }}
        >
          <div className="log-preview-title">Action Details</div>
          <div><strong>User:</strong> {hoveredLog.user}</div>
          <div><strong>Action:</strong> {hoveredLog.action} {hoveredLog.target}</div>
          <div><strong>Time:</strong> {new Date(hoveredLog.time).toLocaleTimeString()}</div>
          {hoveredLog.shapeId && <div><em>Shape is highlighted on canvas</em></div>}
        </div>
      )}
    </div>
  );
}