import React from 'react';
import { FaGithub, FaYoutube } from 'react-icons/fa';
import { FaLink } from 'react-icons/fa6';

interface ProjectLink {
  url: string;
  type: 'github' | 'youtube' | 'link'; 
}

interface ProjectCardProps {
  title: string;
  description: React.ReactNode; 
  mediaUrl: string;
  mediaType?: 'image' | 'video';
  links?: ProjectLink[];
}

const ProjectCard: React.FC<ProjectCardProps> = ({ title, description, mediaUrl, mediaType = 'video', links }) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
      <div className="w-full h-72 overflow-hidden rounded-t-lg">
        {mediaType === 'video' ? (
          <video src={mediaUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
        ) : (
          <img src={mediaUrl} alt={title} className="w-full h-full object-cover" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold mb-2 text-black dark:text-white">{title}</h3>
          <div className="flex space-x-2">
            {links && links.map((link, index) => {
              let Icon;
              if (link.type === 'github') {
                Icon = FaGithub;
              } else if (link.type === 'youtube') {
                Icon = FaYoutube;
              } else {
                Icon = FaLink;
              }
              return (
                <a
                  key={index}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transform hover:scale-110 transition-transform duration-200"
                >
                  <Icon className="w-6 h-6" />
                </a>
              );
            })}
          </div>
        </div>
        <p className="text-gray-700 dark:text-gray-300">{description}</p>
      </div>
    </div>
  );
};

export default ProjectCard;
