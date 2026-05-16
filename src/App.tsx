import { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { FileText, Settings, Bot, PanelLeft, PanelRight, Plus, Trash2, Bold, Italic, Strikethrough, X, Loader2, FolderSync, Download } from 'lucide-react';
import { useStore } from './store/useStore';
import { askLLM } from './lib/llm';

function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSmartPasting, setIsSmartPasting] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'system' | 'user' | 'assistant', content: string}[]>([
    { role: 'assistant', content: 'Ciao! Sono il tuo assistente. MCP attivato. Posso leggere quello che scrivi e aiutarti. Come posso aiutarti oggi?' }
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  const { 
    notes, activeNoteName, activeNoteContent, 
    fetchNotes, createNote, openNote, saveActiveNote, deleteNote,
    settings, updateSettings 
  } = useStore();

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Typography,
      Placeholder.configure({
        placeholder: 'Scrivi qualcosa di magico o usa / per i comandi...',
      }),
    ],
    content: activeNoteContent,
    onUpdate: ({ editor }) => {
      // In a real app, you'd want to debounce this
      saveActiveNote(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none',
      },
      handlePaste: (view, event, slice) => {
        // Only trigger Smart Paste if Shift key is NOT pressed (so Shift+Cmd+V does normal plain text paste)
        // and we have some text or HTML in the clipboard
        if (event.shiftKey) return false;
        
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;

        // If it's a very short string (like a single word), just paste it normally
        if (text.length < 30 && !text.includes('\n')) return false;

        event.preventDefault();
        
        // Fire async Smart Paste
        (async () => {
          setIsSmartPasting(true);
          try {
            const prompt = [
              {
                role: 'system' as const,
                content: `Sei un esperto di formattazione Markdown. L'utente ha incollato del testo grezzo. 
Il tuo unico compito è restituire lo STESSO testo, ma pulito, strutturato e formattato magicamente in un bellissimo Markdown (usa titoli, liste, grassetti, blocchi di codice se appropriato).
Non aggiungere saluti, non aggiungere commenti. Restituisci SOLO il Markdown finale.`
              },
              {
                role: 'user' as const,
                content: text
              }
            ];
            
            const cleanMarkdown = await askLLM(prompt);
            
            // Insert the magically formatted text at current cursor position
            editor.chain().focus().insertContent(cleanMarkdown).run();
            
          } catch (err: any) {
            console.error("Smart paste failed:", err);
            // Fallback: paste raw text if LLM fails
            editor.chain().focus().insertContent(text).run();
          } finally {
            setIsSmartPasting(false);
          }
        })();

        return true; // We handled the paste
      }
    }
  });

  // Sync editor content when active note changes
  useEffect(() => {
    if (editor && activeNoteContent !== undefined && activeNoteContent !== editor.getHTML()) {
      editor.commands.setContent(activeNoteContent);
    }
  }, [activeNoteName, activeNoteContent, editor]);

  const handleCreateNote = () => {
    const name = `Nuova_Nota_${Math.floor(Date.now() / 1000)}.md`;
    createNote(name);
  };

  const handleSelectSyncFolder = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.selectSyncFolder();
      if (res.success && res.data) {
        updateSettings({ syncDirectory: res.data });
        // Immediately fetch notes from the new directory
        fetchNotes();
      }
    }
  };

  const handleExportPdf = async () => {
    if (!editor || !window.electronAPI) return;
    const htmlContent = editor.getHTML();
    const res = await window.electronAPI.exportPdf(htmlContent);
    if (res.success) {
      // Potentially show a success toast here
      console.log('PDF exported to', res.data);
    } else {
      console.error('PDF export failed:', res.error);
    }
  };

  const handleAiSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && aiInput.trim() && !isAiLoading) {
      const userMessage = aiInput;
      setAiInput('');
      
      const newHistory = [...chatHistory, { role: 'user' as const, content: userMessage }];
      setChatHistory(newHistory);
      setIsAiLoading(true);
      
      try {
        const textContext = editor?.getText() || '';
        
        // Prepare context
        const messagesToSent = [
          { 
            role: 'system' as const, 
            content: `Sei un assistente integrato in un editor di testo Markdown. Il tuo obiettivo è aiutare l'utente a scrivere e ragionare. 
            Ecco il contenuto attuale del documento a cui l'utente sta lavorando (se presente):
            """
            ${textContext}
            """
            Rispondi in modo conciso e utile.`
          },
          // Skip the first generic greeting from the UI when sending to LLM
          ...newHistory.filter((_, i) => i !== 0)
        ];

        const response = await askLLM(messagesToSent);
        
        setChatHistory(prev => [...prev, { role: 'assistant', content: response }]);
      } catch (error: any) {
        setChatHistory(prev => [...prev, { role: 'assistant', content: `❌ Errore: ${error.message}. Controlla le impostazioni (Provider e API Key).` }]);
      } finally {
        setIsAiLoading(false);
      }
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-white">
      {/* Titlebar draggable area for Mac */}
      <div className="h-10 w-full flex items-center px-4 drag-region bg-gray-50 border-b border-gray-200" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex space-x-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Traffic lights placeholder area for spacing */}
          <div className="w-16"></div>
        </div>
        <div className="flex-1 flex justify-center text-sm font-medium text-gray-500">
          Noted
        </div>
        <div className="flex space-x-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {activeNoteName && (
            <button 
              onClick={handleExportPdf}
              className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-indigo-600 transition-colors"
              title="Esporta come PDF"
            >
              <Download size={16} />
            </button>
          )}
          <button onClick={() => setLeftOpen(!leftOpen)} className="p-1 hover:bg-gray-200 rounded">
            <PanelLeft size={16} />
          </button>
          <button onClick={() => setRightOpen(!rightOpen)} className="p-1 hover:bg-gray-200 rounded">
            <PanelRight size={16} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal">
          
          {/* Left Sidebar */}
          {leftOpen && (
            <>
              <Panel defaultSize={20} minSize={15} maxSize={30} className="bg-gray-50 flex flex-col border-r border-gray-200">
                <div className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider flex justify-between items-center">
                  <span>Files</span>
                  <button 
                    onClick={handleCreateNote} 
                    className="hover:text-gray-800 p-1"
                    style={{ cursor: 'pointer' }}
                  >
                    <Plus size={14} style={{ pointerEvents: 'none' }} />
                  </button>
                </div>
                <div className="flex-1 px-2 overflow-y-auto">
                  {notes.map(note => (
                    <div 
                      key={note.name}
                      onClick={() => openNote(note.name)}
                      className={`flex items-center justify-between p-2 rounded text-sm cursor-pointer mb-1 group ${activeNoteName === note.name ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-200 text-gray-700'}`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <FileText size={16} className="shrink-0" />
                        <span className="truncate">{note.name.replace('.md', '')}</span>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteNote(note.name); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div 
                  className="p-3 border-t border-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-800"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setIsSettingsOpen(true)}
                >
                  <Settings size={18} style={{ pointerEvents: 'none' }} />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 hover:bg-blue-400 transition-colors cursor-col-resize" />
            </>
          )}

          {/* Center Editor */}
          <Panel className="bg-white overflow-y-auto relative">
            <div className="max-w-3xl mx-auto p-12">
              {activeNoteName ? (
                <>
                  {editor && <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex space-x-1 bg-white border border-gray-200 shadow-lg rounded-lg p-1">
                    <button
                      onClick={() => editor.chain().focus().toggleBold().run()}
                      className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('bold') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}
                    >
                      <Bold size={16} />
                    </button>
                    <button
                      onClick={() => editor.chain().focus().toggleItalic().run()}
                      className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('italic') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}
                    >
                      <Italic size={16} />
                    </button>
                    <button
                      onClick={() => editor.chain().focus().toggleStrike().run()}
                      className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('strike') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}
                    >
                      <Strikethrough size={16} />
                    </button>
                  </BubbleMenu>}
                  <EditorContent editor={editor} />
                  
                  {isSmartPasting && (
                    <div className="absolute top-4 right-4 bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full flex items-center space-x-2 shadow-lg animate-pulse">
                      <Bot size={14} />
                      <span>Smart Paste in corso... ✨</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 mt-32">
                  <FileText size={48} className="mb-4 opacity-20" />
                  <p>Seleziona una nota o creane una nuova</p>
                </div>
              )}
            </div>
          </Panel>

          {/* Right Sidebar (AI / Tools) */}
          {rightOpen && (
            <>
              <PanelResizeHandle className="w-1 hover:bg-blue-400 transition-colors cursor-col-resize" />
              <Panel defaultSize={25} minSize={20} maxSize={40} className="bg-gray-50 flex flex-col border-l border-gray-200">
                <div className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center space-x-2 border-b border-gray-200">
                  <Bot size={14} />
                  <span>AI Assistant</span>
                </div>
                <div className="flex-1 p-4 text-sm text-gray-600 overflow-y-auto flex flex-col space-y-3">
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={`p-3 rounded-lg shadow-sm border border-gray-100 whitespace-pre-wrap ${msg.role === 'assistant' ? 'bg-white' : 'bg-blue-50 text-blue-900 self-end'}`}>
                      {msg.content}
                    </div>
                  ))}
                  {isAiLoading && (
                    <div className="p-3 rounded-lg shadow-sm border border-gray-100 bg-white flex items-center space-x-2 text-gray-400 self-start">
                      <Loader2 size={14} className="animate-spin" />
                      <span>Pensando...</span>
                    </div>
                  )}
                </div>
                <div className="p-3 border-t border-gray-200 bg-white">
                  <input 
                    type="text" 
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    onKeyDown={handleAiSubmit}
                    disabled={isAiLoading}
                    placeholder={isAiLoading ? "Attendi la risposta..." : "Chiedi qualcosa... (Premi Invio)"} 
                    className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 bg-gray-50 disabled:opacity-50" 
                  />
                </div>
              </Panel>
            </>
          )}

        </PanelGroup>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[500px] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="font-semibold text-gray-800">Impostazioni</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider LLM</label>
                <select 
                  className="w-full border border-gray-300 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none"
                  value={settings.llmProvider}
                  onChange={(e) => updateSettings({ llmProvider: e.target.value as any })}
                >
                  <option value="openai">OpenAI (GPT-4o)</option>
                  <option value="anthropic">Anthropic (Claude 3)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="lmstudio">LM Studio (Local)</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>
              
              {settings.llmProvider === 'lmstudio' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">LM Studio API URL</label>
                  <input 
                    type="text" 
                    value={settings.lmStudioUrl}
                    onChange={(e) => updateSettings({ lmStudioUrl: e.target.value })}
                    placeholder="http://localhost:1234/v1" 
                    className="w-full border border-gray-300 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">L'URL locale dove gira LM Studio.</p>
                </div>
              )}

              {['openai', 'anthropic', 'gemini', 'openrouter'].includes(settings.llmProvider) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                  <input 
                    type="password" 
                    value={settings.llmApiKey}
                    onChange={(e) => updateSettings({ llmApiKey: e.target.value })}
                    placeholder="sk-..." 
                    className="w-full border border-gray-300 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">La tua chiave viene salvata solo in locale (localStorage).</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Directory Note</label>
                <div className="flex">
                  <input 
                    type="text" 
                    disabled 
                    value={settings.syncDirectory || "~/Documents/Noted"} 
                    className="flex-1 border border-gray-300 rounded-l-md p-2 text-sm bg-gray-50 text-gray-500"
                  />
                  <button 
                    onClick={handleSelectSyncFolder}
                    className="bg-gray-100 border border-l-0 border-gray-300 px-4 rounded-r-md text-sm text-gray-600 hover:bg-gray-200"
                  >
                    Cambia
                  </button>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button 
                onClick={() => setIsSettingsOpen(false)} 
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
